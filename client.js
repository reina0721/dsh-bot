// dsh-bot · 网页半边（浏览器端，单文件）
//
// 侧栏 bot 名称入口 + 六区整页面板；内部导航不替换 DSH 外层路由。
// 只读写宿主半边的 /onebot-qq/api/* 接口；所有配置项（含默认值、范围、选项）全部来自
// GET /config 的 groups 与共享 settings-schema；profile 保存后由运行解析器应用。
//
// 视觉与动效：令牌、排版、圆角/阴影、页面配方与语义动效体系参考 console-web（社区版 UI 基座）：
//   - 颜色/圆角/阴影/字号来自 TOKEN_CSS（唯一允许十六进制色值的区块）；
//   - enter/swap/reveal/presence/trickle/pulse 等配方与 keyframes 来自 MOTION_CSS；
//   - 其余布局/组件样式在 PANEL_CSS，只消费 --ob-* 变量，不出现裸色值/裸字重；
//   - 动效受 ui.motion（system/full/reduced/off）与 prefers-reduced-motion 双重约束。
//
// 结构：纯函数（可测试）→ 偏好/动效语法 → 令牌/动效/面板样式 → 动效运行时 → UI 原语
//      → 六个标签页 → 根组件 → apply 注册。

window.__ModuleLoader__.load({
  id: 'dsh-bot',
  factory: (require) => {
    const FALLBACK_BRAND = 'dsh-bot'
    const BRAND = (() => {
      try {
        const value = window.__DSH_BOT_BRAND__
        return typeof value === 'string'
          ? [...value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()].slice(0, 40).join('').trimEnd() || FALLBACK_BRAND
          : FALLBACK_BRAND
      } catch (error) { return FALLBACK_BRAND }
    })()
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react') || {}
    const { useState, useEffect, useRef, useCallback, useMemo, useContext, useLayoutEffect, Fragment } = React
    const h = React.createElement

    const inject = ['slots', 'theme']
    const PANEL_ID = 'onebot-qq'
    const API = '/onebot-qq/api'
    const STYLE_ID = 'dsh-bot-panel-style'
    const REFRESH_MIN = 500
    const REFRESH_MAX = 60000
    const LOG_LEVELS = ['debug', 'info', 'warn', 'error']
    const EVENT_KINDS = ['message', 'notice', 'request', 'meta_event', 'unknown']

    // =====================================================================
    // 纯函数区（挂到 module.exports，便于 node:test 直接断言）
    // =====================================================================

    // BEGIN SHARED NAVIGATION (scripts/sync-client-navigation.mjs)
    const DEFAULT_TARGET = {"area":"overview","section":"overview"}
    const NAVIGATION_REGISTRY = [{"id":"overview","label":"Overview","sections":[{"id":"overview","components":["Overview"],"availability":"existing"}]},{"id":"chat","label":"Chat & Sandbox","sections":[{"id":"messages","components":["Messages"],"availability":"existing"},{"id":"sandbox","components":["SandboxChat"],"availability":"existing"}]},{"id":"profiles","label":"Profiles","sections":[{"id":"overview","components":["CognitionTab"],"availability":"existing"},{"id":"library","components":["PersonaTab"],"availability":"existing"},{"id":"general","components":["CogSettings"],"availability":"existing"},{"id":"persona","components":["CogPersona"],"availability":"existing"},{"id":"models","components":["CogSettings"],"availability":"existing"},{"id":"turn","components":["CogSettings"],"availability":"existing"},{"id":"reply","components":["CogSettings"],"availability":"existing"},{"id":"persons","components":["CogPersons"],"availability":"existing"},{"id":"relationships","components":["CogRelationships"],"availability":"existing"},{"id":"memories","components":["CogMemories"],"availability":"existing"},{"id":"timeline","components":["CogTimeline"],"availability":"existing"},{"id":"emotion","components":["CogEmotion"],"availability":"existing"},{"id":"purpose","components":["CogPurpose"],"availability":"existing"},{"id":"policy","components":["CogPolicy"],"availability":"existing"},{"id":"proactivity","components":["CogProactivity"],"availability":"existing"},{"id":"loop","components":["CogLoop"],"availability":"existing"},{"id":"learning","components":["CogLearning"],"availability":"existing"},{"id":"skills","components":["CogSkills"],"availability":"existing"},{"id":"meta","components":["CogMeta"],"availability":"existing"},{"id":"settings","components":["CogSettings"],"availability":"existing"}]},{"id":"extensions","label":"Extensions","sections":[{"id":"modules","components":["ModulesPage"],"availability":"existing"},{"id":"module","components":["CoreModuleHealth","CoreModuleActions"],"availability":"module-dependent"}]},{"id":"data","label":"Data & Logs","sections":[{"id":"media","components":["MediaPage"],"availability":"existing"},{"id":"content","components":["ContentPage"],"availability":"existing"},{"id":"logs","components":["Logs"],"availability":"existing"},{"id":"events","components":["Messages"],"availability":"existing"},{"id":"backup","components":["BackupPage"],"availability":"existing"},{"id":"privacy","components":["CogSettings"],"availability":"existing"},{"id":"import","components":["CogSettings"],"availability":"existing"}]},{"id":"system","label":"System","sections":[{"id":"general","components":["ConfigTab"],"availability":"existing"},{"id":"connection","components":["Connect"],"availability":"existing"},{"id":"timeouts","components":["ConfigTab"],"availability":"existing"},{"id":"appearance","components":["SettingsTab"],"availability":"existing"},{"id":"security","components":["SecurityPage"],"availability":"existing"},{"id":"access","components":["ConfigTab"],"availability":"existing"},{"id":"runtime","components":["ConfigTab"],"availability":"existing"},{"id":"media","components":["ConfigTab"],"availability":"existing"},{"id":"models","components":["ModelTab"],"availability":"existing"},{"id":"diagnostics","components":["CogSettings"],"availability":"existing"},{"id":"about","components":["About"],"availability":"existing"}]}]
    const LEGACY_ALIASES = {"tab:overview":{"area":"overview","section":"overview"},"ob-tab-overview":{"area":"overview","section":"overview"},"ob-panel-overview":{"area":"overview","section":"overview"},"tab:connect":{"area":"system","section":"connection"},"ob-tab-connect":{"area":"system","section":"connection"},"ob-panel-connect":{"area":"system","section":"connection"},"tab:messages":{"area":"chat","section":"messages"},"ob-tab-messages":{"area":"chat","section":"messages"},"ob-panel-messages":{"area":"chat","section":"messages"},"tab:media":{"area":"data","section":"media"},"ob-tab-media":{"area":"data","section":"media"},"ob-panel-media":{"area":"data","section":"media"},"tab:content":{"area":"data","section":"content"},"ob-tab-content":{"area":"data","section":"content"},"ob-panel-content":{"area":"data","section":"content"},"tab:modules":{"area":"extensions","section":"modules"},"ob-tab-modules":{"area":"extensions","section":"modules"},"ob-panel-modules":{"area":"extensions","section":"modules"},"tab:backup":{"area":"data","section":"backup"},"ob-tab-backup":{"area":"data","section":"backup"},"ob-panel-backup":{"area":"data","section":"backup"},"tab:security":{"area":"system","section":"security"},"ob-tab-security":{"area":"system","section":"security"},"ob-panel-security":{"area":"system","section":"security"},"tab:config":{"area":"system","section":"general"},"ob-tab-config":{"area":"system","section":"general"},"ob-panel-config":{"area":"system","section":"general"},"tab:persona":{"area":"profiles","section":"library"},"ob-tab-persona":{"area":"profiles","section":"library"},"ob-panel-persona":{"area":"profiles","section":"library"},"tab:models":{"area":"system","section":"models"},"ob-tab-models":{"area":"system","section":"models"},"ob-panel-models":{"area":"system","section":"models"},"tab:settings":{"area":"system","section":"appearance"},"ob-tab-settings":{"area":"system","section":"appearance"},"ob-panel-settings":{"area":"system","section":"appearance"},"tab:cognition":{"area":"profiles","section":"overview"},"ob-tab-cognition":{"area":"profiles","section":"overview"},"ob-panel-cognition":{"area":"profiles","section":"overview"},"tab:logs":{"area":"data","section":"logs"},"ob-tab-logs":{"area":"data","section":"logs"},"ob-panel-logs":{"area":"data","section":"logs"},"tab:about":{"area":"system","section":"about"},"ob-tab-about":{"area":"system","section":"about"},"ob-panel-about":{"area":"system","section":"about"},"cognition:overview":{"area":"profiles","section":"overview"},"cognition:persona":{"area":"profiles","section":"persona"},"cognition:persons":{"area":"profiles","section":"persons"},"cognition:relationships":{"area":"profiles","section":"relationships"},"cognition:memories":{"area":"profiles","section":"memories"},"cognition:timeline":{"area":"profiles","section":"timeline"},"cognition:emotion":{"area":"profiles","section":"emotion"},"cognition:purpose":{"area":"profiles","section":"purpose"},"cognition:policy":{"area":"profiles","section":"policy"},"cognition:proactivity":{"area":"profiles","section":"proactivity"},"cognition:loop":{"area":"profiles","section":"loop"},"cognition:learning":{"area":"profiles","section":"learning"},"cognition:skills":{"area":"profiles","section":"skills"},"cognition:meta":{"area":"profiles","section":"meta"},"cognition:settings":{"area":"profiles","section":"settings"},"group:sandbox":{"area":"system","section":"security"},"group:basic":{"area":"system","section":"general"},"group:endpoint":{"area":"system","section":"connection"},"group:snowluma":{"area":"system","section":"connection"},"group:timeouts":{"area":"system","section":"timeouts"},"group:events":{"area":"data","section":"events"},"group:logging":{"area":"data","section":"logs"},"group:ui":{"area":"system","section":"appearance"},"group:security":{"area":"system","section":"security"},"group:access":{"area":"system","section":"access"},"group:runtime":{"area":"system","section":"runtime"},"group:media":{"area":"system","section":"media"},"group:content":{"area":"extensions","section":"module","moduleId":"builtin-media-features","anchor":"ob-module-config"},"group:ops":{"area":"data","section":"backup"},"group:cog-core":{"area":"profiles","section":"general"},"group:cog-permissions":{"area":"system","section":"access"},"group:cog-reminders":{"area":"extensions","section":"module","moduleId":"builtin-reminders","anchor":"ob-module-config"},"group:cog-llm":{"area":"profiles","section":"models"},"group:cog-turn":{"area":"profiles","section":"turn"},"group:cog-reply":{"area":"profiles","section":"reply"},"group:cog-admin":{"area":"system","section":"access"},"group:cog-purpose":{"area":"profiles","section":"purpose"},"group:cog-persona":{"area":"profiles","section":"persona"},"group:cog-emotion":{"area":"profiles","section":"emotion"},"group:cog-relationship":{"area":"profiles","section":"relationships"},"group:cog-memory":{"area":"profiles","section":"memories"},"group:cog-import":{"area":"data","section":"import"},"group:cog-policy":{"area":"profiles","section":"policy"},"group:cog-learning":{"area":"extensions","section":"module","moduleId":"builtin-learning","anchor":"ob-module-config"},"group:cog-proactivity":{"area":"extensions","section":"module","moduleId":"builtin-proactivity","anchor":"ob-module-config"},"group:cog-privacy":{"area":"data","section":"privacy"},"settings:appearance":{"area":"system","section":"appearance","anchor":"appearance"},"settings:layout":{"area":"system","section":"appearance","anchor":"layout"},"settings:data":{"area":"system","section":"appearance","anchor":"data"},"settings:motion":{"area":"system","section":"appearance","anchor":"motion"},"settings:reset":{"area":"system","section":"appearance","anchor":"reset"},"module:builtin-learning":{"area":"extensions","section":"module","moduleId":"builtin-learning","anchor":"ob-module-detail"},"module:builtin-proactivity":{"area":"extensions","section":"module","moduleId":"builtin-proactivity","anchor":"ob-module-detail"},"module:builtin-media-features":{"area":"extensions","section":"module","moduleId":"builtin-media-features","anchor":"ob-module-detail"},"module:builtin-reminders":{"area":"extensions","section":"module","moduleId":"builtin-reminders","anchor":"ob-module-detail"},"module:builtin-typing":{"area":"extensions","section":"module","moduleId":"builtin-typing","anchor":"ob-module-detail"},"module:builtin-reply-delivery":{"area":"extensions","section":"module","moduleId":"builtin-reply-delivery","anchor":"ob-module-detail"},"module:builtin-sample":{"area":"extensions","section":"module","moduleId":"builtin-sample","anchor":"ob-module-detail"},"ob-media-stickers":{"area":"data","section":"media","anchor":"ob-media-stickers"},"ob-cog-unknowns":{"area":"profiles","section":"learning","anchor":"ob-cog-unknowns"},"ob-cog-tasks":{"area":"profiles","section":"learning","anchor":"ob-cog-tasks"},"ob-cog-claims":{"area":"profiles","section":"learning","anchor":"ob-cog-claims"},"ob-module-detail":{"area":"extensions","section":"module","anchor":"ob-module-detail"},"ob-module-config":{"area":"extensions","section":"module","anchor":"ob-module-config"},"ob-module-panel":{"area":"extensions","section":"module","anchor":"ob-module-panel"},"ob-module-reminders":{"area":"extensions","section":"module","anchor":"ob-module-reminders"}}
    const LEGACY_TABS = {"overview":{"area":"overview","section":"overview"},"connect":{"area":"system","section":"connection"},"messages":{"area":"chat","section":"messages"},"media":{"area":"data","section":"media"},"content":{"area":"data","section":"content"},"modules":{"area":"extensions","section":"modules"},"backup":{"area":"data","section":"backup"},"security":{"area":"system","section":"security"},"config":{"area":"system","section":"general"},"persona":{"area":"profiles","section":"library"},"models":{"area":"system","section":"models"},"settings":{"area":"system","section":"appearance"},"cognition":{"area":"profiles","section":"overview"},"logs":{"area":"data","section":"logs"},"about":{"area":"system","section":"about"}}
    const LEGACY_COGNITION_SECTIONS = {"overview":{"area":"profiles","section":"overview"},"persona":{"area":"profiles","section":"persona"},"persons":{"area":"profiles","section":"persons"},"relationships":{"area":"profiles","section":"relationships"},"memories":{"area":"profiles","section":"memories"},"timeline":{"area":"profiles","section":"timeline"},"emotion":{"area":"profiles","section":"emotion"},"purpose":{"area":"profiles","section":"purpose"},"policy":{"area":"profiles","section":"policy"},"proactivity":{"area":"profiles","section":"proactivity"},"loop":{"area":"profiles","section":"loop"},"learning":{"area":"profiles","section":"learning"},"skills":{"area":"profiles","section":"skills"},"meta":{"area":"profiles","section":"meta"},"settings":{"area":"profiles","section":"settings"}}
    const LEGACY_CONFIG_GROUPS = {"sandbox":{"area":"system","section":"security"},"basic":{"area":"system","section":"general"},"endpoint":{"area":"system","section":"connection"},"snowluma":{"area":"system","section":"connection"},"timeouts":{"area":"system","section":"timeouts"},"events":{"area":"data","section":"events"},"logging":{"area":"data","section":"logs"},"ui":{"area":"system","section":"appearance"},"security":{"area":"system","section":"security"},"access":{"area":"system","section":"access"},"runtime":{"area":"system","section":"runtime"},"media":{"area":"system","section":"media"},"content":{"area":"extensions","section":"module","moduleId":"builtin-media-features","anchor":"ob-module-config"},"ops":{"area":"data","section":"backup"},"cog-core":{"area":"profiles","section":"general"},"cog-permissions":{"area":"system","section":"access"},"cog-reminders":{"area":"extensions","section":"module","moduleId":"builtin-reminders","anchor":"ob-module-config"},"cog-llm":{"area":"profiles","section":"models"},"cog-turn":{"area":"profiles","section":"turn"},"cog-reply":{"area":"profiles","section":"reply"},"cog-admin":{"area":"system","section":"access"},"cog-purpose":{"area":"profiles","section":"purpose"},"cog-persona":{"area":"profiles","section":"persona"},"cog-emotion":{"area":"profiles","section":"emotion"},"cog-relationship":{"area":"profiles","section":"relationships"},"cog-memory":{"area":"profiles","section":"memories"},"cog-import":{"area":"data","section":"import"},"cog-policy":{"area":"profiles","section":"policy"},"cog-learning":{"area":"extensions","section":"module","moduleId":"builtin-learning","anchor":"ob-module-config"},"cog-proactivity":{"area":"extensions","section":"module","moduleId":"builtin-proactivity","anchor":"ob-module-config"},"cog-privacy":{"area":"data","section":"privacy"}}
    const LEGACY_MODULE_IDS = ["builtin-learning","builtin-proactivity","builtin-media-features","builtin-reminders","builtin-typing","builtin-reply-delivery","builtin-sample"]
    const LEGACY_ANCHORS = {"ob-media-stickers":{"area":"data","section":"media","anchor":"ob-media-stickers"},"ob-cog-unknowns":{"area":"profiles","section":"learning","anchor":"ob-cog-unknowns"},"ob-cog-tasks":{"area":"profiles","section":"learning","anchor":"ob-cog-tasks"},"ob-cog-claims":{"area":"profiles","section":"learning","anchor":"ob-cog-claims"},"ob-module-detail":{"area":"extensions","section":"module","anchor":"ob-module-detail"},"ob-module-config":{"area":"extensions","section":"module","anchor":"ob-module-config"},"ob-module-panel":{"area":"extensions","section":"module","anchor":"ob-module-panel"},"ob-module-reminders":{"area":"extensions","section":"module","anchor":"ob-module-reminders"}}
    const LEGACY_SETTINGS_SECTIONS = {"appearance":{"area":"system","section":"appearance","anchor":"appearance"},"layout":{"area":"system","section":"appearance","anchor":"layout"},"data":{"area":"system","section":"appearance","anchor":"data"},"motion":{"area":"system","section":"appearance","anchor":"motion"},"reset":{"area":"system","section":"appearance","anchor":"reset"}}
    const SETTINGS_FIELDS = [{"path":"sandbox.enabled","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"security"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"sandbox","aliases":["sandbox.enabled","group:sandbox/sandbox.enabled"]},{"path":"sandbox.driver","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"security"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"sandbox","aliases":["sandbox.driver","group:sandbox/sandbox.driver"]},{"path":"sandbox.network","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"security"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"sandbox","aliases":["sandbox.network","group:sandbox/sandbox.network"]},{"path":"sandbox.limits.concurrency","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"security"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"sandbox","aliases":["sandbox.limits.concurrency","group:sandbox/sandbox.limits.concurrency"]},{"path":"sandbox.limits.jobs","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"security"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"sandbox","aliases":["sandbox.limits.jobs","group:sandbox/sandbox.limits.jobs"]},{"path":"sandbox.limits.timeoutMs","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"security"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"sandbox","aliases":["sandbox.limits.timeoutMs","group:sandbox/sandbox.limits.timeoutMs"]},{"path":"sandbox.limits.outputBytes","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"security"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"sandbox","aliases":["sandbox.limits.outputBytes","group:sandbox/sandbox.limits.outputBytes"]},{"path":"sandbox.limits.memoryMiB","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"security"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"sandbox","aliases":["sandbox.limits.memoryMiB","group:sandbox/sandbox.limits.memoryMiB"]},{"path":"sandbox.limits.processes","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"security"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"sandbox","aliases":["sandbox.limits.processes","group:sandbox/sandbox.limits.processes"]},{"path":"sandbox.policy.ownerPrivate","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"security"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"sandbox","aliases":["sandbox.policy.ownerPrivate","group:sandbox/sandbox.policy.ownerPrivate"]},{"path":"sandbox.policy.operatorPrivate","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"security"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"sandbox","aliases":["sandbox.policy.operatorPrivate","group:sandbox/sandbox.policy.operatorPrivate"]},{"path":"sandbox.policy.otherPrivate","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"security"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"sandbox","aliases":["sandbox.policy.otherPrivate","group:sandbox/sandbox.policy.otherPrivate"]},{"path":"sandbox.policy.group","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"security"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"sandbox","aliases":["sandbox.policy.group","group:sandbox/sandbox.policy.group"]},{"path":"version","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"runtime"},"sensitivity":"public","apply":"read-only","exposure":"internal","storage":"config.json","legacyGroup":null,"aliases":["version"]},{"path":"cognition.delivery.engine","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"runtime"},"sensitivity":"public","apply":"read-only","exposure":"internal","storage":"config.json","legacyGroup":null,"aliases":["cognition.delivery.engine"]},{"path":"enabled","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"general"},"sensitivity":"public","apply":"gateway-reconnect","exposure":"panel","storage":"config.json","legacyGroup":"basic","aliases":["enabled","group:basic/enabled"]},{"path":"gateway","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"general"},"sensitivity":"public","apply":"gateway-reconnect","exposure":"panel","storage":"config.json","legacyGroup":"basic","aliases":["gateway","group:basic/gateway"]},{"path":"botQQ","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"general"},"sensitivity":"private","apply":"gateway-reconnect","exposure":"panel","storage":"config.json","legacyGroup":"basic","aliases":["botQQ","group:basic/botQQ"]},{"path":"accountCheck","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"general"},"sensitivity":"public","apply":"gateway-reconnect","exposure":"panel","storage":"config.json","legacyGroup":"basic","aliases":["accountCheck","group:basic/accountCheck"]},{"path":"onebot.wsUrl","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"connection"},"sensitivity":"private","apply":"gateway-reconnect","exposure":"panel","storage":"config.json","legacyGroup":"endpoint","aliases":["onebot.wsUrl","group:endpoint/onebot.wsUrl"]},{"path":"onebot.httpUrl","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"connection"},"sensitivity":"private","apply":"gateway-reconnect","exposure":"panel","storage":"config.json","legacyGroup":"endpoint","aliases":["onebot.httpUrl","group:endpoint/onebot.httpUrl"]},{"path":"onebot.wsToken","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"connection"},"sensitivity":"secret","apply":"gateway-reconnect","exposure":"panel","storage":"config.json","legacyGroup":"endpoint","aliases":["onebot.wsToken","group:endpoint/onebot.wsToken"]},{"path":"onebot.httpToken","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"connection"},"sensitivity":"secret","apply":"gateway-reconnect","exposure":"panel","storage":"config.json","legacyGroup":"endpoint","aliases":["onebot.httpToken","group:endpoint/onebot.httpToken"]},{"path":"onebot.httpAuth","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"connection"},"sensitivity":"public","apply":"gateway-reconnect","exposure":"panel","storage":"config.json","legacyGroup":"endpoint","aliases":["onebot.httpAuth","group:endpoint/onebot.httpAuth"]},{"path":"reconnect.enabled","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"connection"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"endpoint","aliases":["reconnect.enabled","group:endpoint/reconnect.enabled"]},{"path":"reconnect.minDelayMs","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"connection"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"endpoint","aliases":["reconnect.minDelayMs","group:endpoint/reconnect.minDelayMs"]},{"path":"reconnect.maxDelayMs","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"connection"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"endpoint","aliases":["reconnect.maxDelayMs","group:endpoint/reconnect.maxDelayMs"]},{"path":"reconnect.factor","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"connection"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"endpoint","aliases":["reconnect.factor","group:endpoint/reconnect.factor"]},{"path":"reconnect.jitterRatio","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"connection"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"endpoint","aliases":["reconnect.jitterRatio","group:endpoint/reconnect.jitterRatio"]},{"path":"snowluma.dir","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"connection"},"sensitivity":"private","apply":"gateway-reconnect","exposure":"panel","storage":"config.json","legacyGroup":"snowluma","aliases":["snowluma.dir","group:snowluma/snowluma.dir"]},{"path":"snowluma.uin","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"connection"},"sensitivity":"private","apply":"gateway-reconnect","exposure":"panel","storage":"config.json","legacyGroup":"snowluma","aliases":["snowluma.uin","group:snowluma/snowluma.uin"]},{"path":"snowluma.autoDetect","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"connection"},"sensitivity":"public","apply":"gateway-reconnect","exposure":"panel","storage":"config.json","legacyGroup":"snowluma","aliases":["snowluma.autoDetect","group:snowluma/snowluma.autoDetect"]},{"path":"timeouts.callMs","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"timeouts"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"timeouts","aliases":["timeouts.callMs","group:timeouts/timeouts.callMs"]},{"path":"timeouts.connectMs","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"timeouts"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"timeouts","aliases":["timeouts.connectMs","group:timeouts/timeouts.connectMs"]},{"path":"timeouts.verifyMs","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"timeouts"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"timeouts","aliases":["timeouts.verifyMs","group:timeouts/timeouts.verifyMs"]},{"path":"timeouts.probeMs","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"timeouts"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"timeouts","aliases":["timeouts.probeMs","group:timeouts/timeouts.probeMs"]},{"path":"timeouts.maxRetries","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"timeouts"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"timeouts","aliases":["timeouts.maxRetries","group:timeouts/timeouts.maxRetries"]},{"path":"timeouts.retryDelaysMs","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"timeouts"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"timeouts","aliases":["timeouts.retryDelaysMs","group:timeouts/timeouts.retryDelaysMs"]},{"path":"verification.enabled","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"timeouts"},"sensitivity":"public","apply":"gateway-reconnect","exposure":"panel","storage":"config.json","legacyGroup":"timeouts","aliases":["verification.enabled","group:timeouts/verification.enabled"]},{"path":"verification.bufferSize","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"timeouts"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"timeouts","aliases":["verification.bufferSize","group:timeouts/verification.bufferSize"]},{"path":"events.enabled","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"events"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"events","aliases":["events.enabled","group:events/events.enabled"]},{"path":"events.bufferSize","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"events"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"events","aliases":["events.bufferSize","group:events/events.bufferSize"]},{"path":"events.includeSelfMessages","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"events"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"events","aliases":["events.includeSelfMessages","group:events/events.includeSelfMessages"]},{"path":"events.kinds.message","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"events"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"events","aliases":["events.kinds.message","group:events/events.kinds.message"]},{"path":"events.kinds.notice","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"events"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"events","aliases":["events.kinds.notice","group:events/events.kinds.notice"]},{"path":"events.kinds.request","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"events"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"events","aliases":["events.kinds.request","group:events/events.kinds.request"]},{"path":"events.kinds.meta_event","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"events"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"events","aliases":["events.kinds.meta_event","group:events/events.kinds.meta_event"]},{"path":"events.messageSubTypes.private","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"events"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"events","aliases":["events.messageSubTypes.private","group:events/events.messageSubTypes.private"]},{"path":"events.messageSubTypes.group","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"events"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"events","aliases":["events.messageSubTypes.group","group:events/events.messageSubTypes.group"]},{"path":"events.ignoreUsers","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"events"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"events","aliases":["events.ignoreUsers","group:events/events.ignoreUsers"]},{"path":"events.ignoreGroups","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"events"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"events","aliases":["events.ignoreGroups","group:events/events.ignoreGroups"]},{"path":"events.rawMaxBytes","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"events"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"events","aliases":["events.rawMaxBytes","group:events/events.rawMaxBytes"]},{"path":"events.persist.enabled","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"events"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"events","aliases":["events.persist.enabled","group:events/events.persist.enabled"]},{"path":"events.persist.file","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"events"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"events","aliases":["events.persist.file","group:events/events.persist.file"]},{"path":"events.persist.maxMB","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"events"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"events","aliases":["events.persist.maxMB","group:events/events.persist.maxMB"]},{"path":"logging.level","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"logs"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"logging","aliases":["logging.level","group:logging/logging.level"]},{"path":"logging.bufferSize","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"logs"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"logging","aliases":["logging.bufferSize","group:logging/logging.bufferSize"]},{"path":"logging.persist.enabled","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"logs"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"logging","aliases":["logging.persist.enabled","group:logging/logging.persist.enabled"]},{"path":"logging.redact","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"logs"},"sensitivity":"public","apply":"next-use","exposure":"config-file","storage":"config.json","legacyGroup":"logging","aliases":["logging.redact","group:logging/logging.redact"]},{"path":"ui.refreshMs","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"appearance"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ui","aliases":["ui.refreshMs","group:ui/ui.refreshMs"]},{"path":"ui.eventPageSize","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"appearance"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ui","aliases":["ui.eventPageSize","group:ui/ui.eventPageSize"]},{"path":"ui.logPageSize","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"appearance"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ui","aliases":["ui.logPageSize","group:ui/ui.logPageSize"]},{"path":"ui.accent","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"appearance"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ui","aliases":["ui.accent","group:ui/ui.accent"]},{"path":"ui.density","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"appearance"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ui","aliases":["ui.density","group:ui/ui.density"]},{"path":"ui.fontScale","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"appearance"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ui","aliases":["ui.fontScale","group:ui/ui.fontScale"]},{"path":"ui.contentWidth","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"appearance"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ui","aliases":["ui.contentWidth","group:ui/ui.contentWidth"]},{"path":"ui.motion","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"appearance"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ui","aliases":["ui.motion","group:ui/ui.motion"]},{"path":"ui.pageTransition","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"appearance"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ui","aliases":["ui.pageTransition","group:ui/ui.pageTransition"]},{"path":"ui.contrast","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"appearance"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ui","aliases":["ui.contrast","group:ui/ui.contrast"]},{"path":"security.allowRawAction","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"security"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"security","aliases":["security.allowRawAction","group:security/security.allowRawAction"]},{"path":"security.leakGuard.enabled","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"security"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"security","aliases":["security.leakGuard.enabled","group:security/security.leakGuard.enabled"]},{"path":"security.leakGuard.action","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"security"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"security","aliases":["security.leakGuard.action","group:security/security.leakGuard.action"]},{"path":"ops.upgrade.enabled","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"backup"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ops","aliases":["ops.upgrade.enabled","group:ops/ops.upgrade.enabled"]},{"path":"ops.upgrade.channel","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"backup"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ops","aliases":["ops.upgrade.channel","group:ops/ops.upgrade.channel"]},{"path":"ops.upgrade.repo","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"backup"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ops","aliases":["ops.upgrade.repo","group:ops/ops.upgrade.repo"]},{"path":"ops.upgrade.timeoutMs","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"backup"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ops","aliases":["ops.upgrade.timeoutMs","group:ops/ops.upgrade.timeoutMs"]},{"path":"ops.upgrade.cacheMinutes","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"backup"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ops","aliases":["ops.upgrade.cacheMinutes","group:ops/ops.upgrade.cacheMinutes"]},{"path":"ops.backup.enabled","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"backup"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ops","aliases":["ops.backup.enabled","group:ops/ops.backup.enabled"]},{"path":"ops.backup.includeMedia","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"backup"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ops","aliases":["ops.backup.includeMedia","group:ops/ops.backup.includeMedia"]},{"path":"ops.backup.maxSnapshots","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"backup"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ops","aliases":["ops.backup.maxSnapshots","group:ops/ops.backup.maxSnapshots"]},{"path":"ops.backup.maxBytes","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"backup"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ops","aliases":["ops.backup.maxBytes","group:ops/ops.backup.maxBytes"]},{"path":"ops.backup.maxFiles","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"backup"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ops","aliases":["ops.backup.maxFiles","group:ops/ops.backup.maxFiles"]},{"path":"ops.backup.prune","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"backup"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ops","aliases":["ops.backup.prune","group:ops/ops.backup.prune"]},{"path":"ops.backup.allowRestore","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"backup"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"ops","aliases":["ops.backup.allowRestore","group:ops/ops.backup.allowRestore"]},{"path":"media.enabled","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.enabled","group:media/media.enabled"]},{"path":"media.maxBytes","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.maxBytes","group:media/media.maxBytes"]},{"path":"media.dir","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.dir","group:media/media.dir"]},{"path":"media.tts.maxChars","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.tts.maxChars","group:media/media.tts.maxChars"]},{"path":"media.images.enabled","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.images.enabled","group:media/media.images.enabled"]},{"path":"media.images.visionEnabled","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.images.visionEnabled","group:media/media.images.visionEnabled"]},{"path":"media.images.visionBaseUrl","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.images.visionBaseUrl","group:media/media.images.visionBaseUrl"]},{"path":"media.images.visionModel","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.images.visionModel","group:media/media.images.visionModel"]},{"path":"media.images.visionApiKeyEnv","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"secret-reference","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.images.visionApiKeyEnv","group:media/media.images.visionApiKeyEnv"]},{"path":"media.images.generateEnabled","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.images.generateEnabled","group:media/media.images.generateEnabled"]},{"path":"media.images.generateBaseUrl","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.images.generateBaseUrl","group:media/media.images.generateBaseUrl"]},{"path":"media.images.generateModel","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.images.generateModel","group:media/media.images.generateModel"]},{"path":"media.images.generateApiKeyEnv","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"secret-reference","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.images.generateApiKeyEnv","group:media/media.images.generateApiKeyEnv"]},{"path":"media.images.generateSize","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.images.generateSize","group:media/media.images.generateSize"]},{"path":"media.images.editEnabled","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.images.editEnabled","group:media/media.images.editEnabled"]},{"path":"media.images.editBaseUrl","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.images.editBaseUrl","group:media/media.images.editBaseUrl"]},{"path":"media.images.editModel","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.images.editModel","group:media/media.images.editModel"]},{"path":"media.images.editApiKeyEnv","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"secret-reference","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.images.editApiKeyEnv","group:media/media.images.editApiKeyEnv"]},{"path":"media.images.editSize","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.images.editSize","group:media/media.images.editSize"]},{"path":"media.audio.asrEnabled","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.audio.asrEnabled","group:media/media.audio.asrEnabled"]},{"path":"media.audio.asrBaseUrl","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.audio.asrBaseUrl","group:media/media.audio.asrBaseUrl"]},{"path":"media.audio.asrModel","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.audio.asrModel","group:media/media.audio.asrModel"]},{"path":"media.audio.asrApiKeyEnv","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"secret-reference","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.audio.asrApiKeyEnv","group:media/media.audio.asrApiKeyEnv"]},{"path":"media.audio.ttsEnabled","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.audio.ttsEnabled","group:media/media.audio.ttsEnabled"]},{"path":"media.audio.ttsBaseUrl","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.audio.ttsBaseUrl","group:media/media.audio.ttsBaseUrl"]},{"path":"media.audio.ttsModel","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.audio.ttsModel","group:media/media.audio.ttsModel"]},{"path":"media.audio.ttsVoice","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.audio.ttsVoice","group:media/media.audio.ttsVoice"]},{"path":"media.audio.ttsApiKeyEnv","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"secret-reference","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.audio.ttsApiKeyEnv","group:media/media.audio.ttsApiKeyEnv"]},{"path":"media.files.enabled","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"media"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.files.enabled","group:media/media.files.enabled"]},{"path":"media.stickers.enabled","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-media-features","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.stickers.enabled","group:media/media.stickers.enabled"]},{"path":"media.stickers.maxCount","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-media-features","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.stickers.maxCount","group:media/media.stickers.maxCount"]},{"path":"media.stickers.maxBytes","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-media-features","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"media","aliases":["media.stickers.maxBytes","group:media/media.stickers.maxBytes"]},{"path":"content.bilibili.enabled","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-media-features","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"content","aliases":["content.bilibili.enabled","group:content/content.bilibili.enabled"]},{"path":"content.bilibili.timeoutMs","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-media-features","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"content","aliases":["content.bilibili.timeoutMs","group:content/content.bilibili.timeoutMs"]},{"path":"content.bilibili.maxResults","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-media-features","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"content","aliases":["content.bilibili.maxResults","group:content/content.bilibili.maxResults"]},{"path":"access.mode","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"access"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"access","aliases":["access.mode","group:access/access.mode"]},{"path":"access.ownerQQ","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"access"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"access","aliases":["access.ownerQQ","group:access/access.ownerQQ"]},{"path":"access.ownerName","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"access"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"access","aliases":["access.ownerName","group:access/access.ownerName"]},{"path":"access.operators","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"access"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"access","aliases":["access.operators","group:access/access.operators"]},{"path":"access.private","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"access"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"access","aliases":["access.private","group:access/access.private"]},{"path":"access.groups","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"access"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"access","aliases":["access.groups","group:access/access.groups"]},{"path":"access.auditSize","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"access"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"access","aliases":["access.auditSize","group:access/access.auditSize"]},{"path":"runtime.engine","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"runtime"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"runtime","aliases":["runtime.engine","group:runtime/runtime.engine"]},{"path":"runtime.workspaceDir","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"runtime"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"runtime","aliases":["runtime.workspaceDir","group:runtime/runtime.workspaceDir"]},{"path":"runtime.replyTimeoutMs","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"runtime"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"runtime","aliases":["runtime.replyTimeoutMs","group:runtime/runtime.replyTimeoutMs"]},{"path":"cognition.enabled","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"general"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-core","aliases":["cognition.enabled","group:cog-core/cognition.enabled"]},{"path":"cognition.paused","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"general"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-core","aliases":["cognition.paused","group:cog-core/cognition.paused"]},{"path":"cognition.dryRun","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"general"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-core","aliases":["cognition.dryRun","group:cog-core/cognition.dryRun"]},{"path":"cognition.locale","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"general"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-core","aliases":["cognition.locale","group:cog-core/cognition.locale"]},{"path":"cognition.timezone","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"general"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-core","aliases":["cognition.timezone","group:cog-core/cognition.timezone"]},{"path":"cognition.typing.enabled","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-typing","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-turn","aliases":["cognition.typing.enabled","group:cog-turn/cognition.typing.enabled"]},{"path":"cognition.turn.privateBaseMs","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"turn"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-turn","aliases":["cognition.turn.privateBaseMs","group:cog-turn/cognition.turn.privateBaseMs"]},{"path":"cognition.turn.privateMaxMs","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"turn"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-turn","aliases":["cognition.turn.privateMaxMs","group:cog-turn/cognition.turn.privateMaxMs"]},{"path":"cognition.turn.groupMaxMs","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"turn"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-turn","aliases":["cognition.turn.groupMaxMs","group:cog-turn/cognition.turn.groupMaxMs"]},{"path":"cognition.turn.fastPathMs","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"turn"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-turn","aliases":["cognition.turn.fastPathMs","group:cog-turn/cognition.turn.fastPathMs"]},{"path":"cognition.turn.shortMsgMs","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"turn"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-turn","aliases":["cognition.turn.shortMsgMs","group:cog-turn/cognition.turn.shortMsgMs"]},{"path":"cognition.turn.incompleteFactorMs","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"turn"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-turn","aliases":["cognition.turn.incompleteFactorMs","group:cog-turn/cognition.turn.incompleteFactorMs"]},{"path":"cognition.turn.habitAdjMaxMs","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"turn"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-turn","aliases":["cognition.turn.habitAdjMaxMs","group:cog-turn/cognition.turn.habitAdjMaxMs"]},{"path":"cognition.turn.maxAggregateMessages","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"turn"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-turn","aliases":["cognition.turn.maxAggregateMessages","group:cog-turn/cognition.turn.maxAggregateMessages"]},{"path":"cognition.turn.groupReplyMode","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"turn"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-turn","aliases":["cognition.turn.groupReplyMode","group:cog-turn/cognition.turn.groupReplyMode"]},{"path":"cognition.turn.groupReplyProbability","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"turn"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-turn","aliases":["cognition.turn.groupReplyProbability","group:cog-turn/cognition.turn.groupReplyProbability"]},{"path":"cognition.turn.groupRelevance.enabled","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"turn"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-turn","aliases":["cognition.turn.groupRelevance.enabled","group:cog-turn/cognition.turn.groupRelevance.enabled"]},{"path":"cognition.turn.groupRelevance.minScore","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"turn"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-turn","aliases":["cognition.turn.groupRelevance.minScore","group:cog-turn/cognition.turn.groupRelevance.minScore"]},{"path":"cognition.turn.groupCooldownMs","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"turn"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-turn","aliases":["cognition.turn.groupCooldownMs","group:cog-turn/cognition.turn.groupCooldownMs"]},{"path":"cognition.turn.groupMaxRepliesPerMinute","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"turn"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-turn","aliases":["cognition.turn.groupMaxRepliesPerMinute","group:cog-turn/cognition.turn.groupMaxRepliesPerMinute"]},{"path":"cognition.turn.maxConsecutiveGroupReplies","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"turn"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-turn","aliases":["cognition.turn.maxConsecutiveGroupReplies","group:cog-turn/cognition.turn.maxConsecutiveGroupReplies"]},{"path":"cognition.turn.addressedOnlyGroups","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"turn"},"sensitivity":"public","apply":"read-only","exposure":"internal","storage":"config.json","legacyGroup":"cog-turn","aliases":["cognition.turn.addressedOnlyGroups","group:cog-turn/cognition.turn.addressedOnlyGroups"]},{"path":"cognition.turn.wakeWords","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"turn"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-turn","aliases":["cognition.turn.wakeWords","group:cog-turn/cognition.turn.wakeWords"]},{"path":"cognition.reply.split","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-reply-delivery","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-reply","aliases":["cognition.reply.split","group:cog-reply/cognition.reply.split"]},{"path":"cognition.reply.maxChars","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-reply-delivery","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-reply","aliases":["cognition.reply.maxChars","group:cog-reply/cognition.reply.maxChars"]},{"path":"cognition.reply.maxParts","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-reply-delivery","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-reply","aliases":["cognition.reply.maxParts","group:cog-reply/cognition.reply.maxParts"]},{"path":"cognition.reply.delayMs","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-reply-delivery","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-reply","aliases":["cognition.reply.delayMs","group:cog-reply/cognition.reply.delayMs"]},{"path":"cognition.reply.quote","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-reply-delivery","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-reply","aliases":["cognition.reply.quote","group:cog-reply/cognition.reply.quote"]},{"path":"cognition.reply.atSender","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-reply-delivery","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-reply","aliases":["cognition.reply.atSender","group:cog-reply/cognition.reply.atSender"]},{"path":"cognition.notices.enabled","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"reply"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-reply","aliases":["cognition.notices.enabled","group:cog-reply/cognition.notices.enabled"]},{"path":"cognition.requests.enabled","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"reply"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-reply","aliases":["cognition.requests.enabled","group:cog-reply/cognition.requests.enabled"]},{"path":"cognition.notice.patReply","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"reply"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-reply","aliases":["cognition.notice.patReply","group:cog-reply/cognition.notice.patReply"]},{"path":"cognition.notice.patCooldownMs","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"reply"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-reply","aliases":["cognition.notice.patCooldownMs","group:cog-reply/cognition.notice.patCooldownMs"]},{"path":"cognition.permissions.deniedCommands","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"access"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-permissions","aliases":["cognition.permissions.deniedCommands","group:cog-permissions/cognition.permissions.deniedCommands"]},{"path":"cognition.reminders.enabled","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-reminders","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-reminders","aliases":["cognition.reminders.enabled","group:cog-reminders/cognition.reminders.enabled"]},{"path":"cognition.reminders.maxActive","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-reminders","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-reminders","aliases":["cognition.reminders.maxActive","group:cog-reminders/cognition.reminders.maxActive"]},{"path":"cognition.reminders.minIntervalSeconds","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-reminders","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-reminders","aliases":["cognition.reminders.minIntervalSeconds","group:cog-reminders/cognition.reminders.minIntervalSeconds"]},{"path":"cognition.reminders.maxIntervalSeconds","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-reminders","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-reminders","aliases":["cognition.reminders.maxIntervalSeconds","group:cog-reminders/cognition.reminders.maxIntervalSeconds"]},{"path":"cognition.reminders.tickMs","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-reminders","anchor":"ob-module-config"},"sensitivity":"public","apply":"module-restart","exposure":"panel","storage":"config.json","legacyGroup":"cog-reminders","aliases":["cognition.reminders.tickMs","group:cog-reminders/cognition.reminders.tickMs"]},{"path":"cognition.qqAdmin.enabled","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"access"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-admin","aliases":["cognition.qqAdmin.enabled","group:cog-admin/cognition.qqAdmin.enabled"]},{"path":"cognition.qqAdmin.requireApproval","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"access"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-admin","aliases":["cognition.qqAdmin.requireApproval","group:cog-admin/cognition.qqAdmin.requireApproval"]},{"path":"cognition.qqAdmin.requireConfirm","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"access"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-admin","aliases":["cognition.qqAdmin.requireConfirm","group:cog-admin/cognition.qqAdmin.requireConfirm"]},{"path":"cognition.qqAdmin.maxText","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"access"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-admin","aliases":["cognition.qqAdmin.maxText","group:cog-admin/cognition.qqAdmin.maxText"]},{"path":"cognition.purpose.enabled","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"purpose"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-purpose","aliases":["cognition.purpose.enabled","group:cog-purpose/cognition.purpose.enabled"]},{"path":"cognition.purpose.maxActive","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"purpose"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-purpose","aliases":["cognition.purpose.maxActive","group:cog-purpose/cognition.purpose.maxActive"]},{"path":"cognition.purpose.injectPrompt","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"purpose"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-purpose","aliases":["cognition.purpose.injectPrompt","group:cog-purpose/cognition.purpose.injectPrompt"]},{"path":"cognition.purpose.promptLimit","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"purpose"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-purpose","aliases":["cognition.purpose.promptLimit","group:cog-purpose/cognition.purpose.promptLimit"]},{"path":"cognition.import.enabled","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"import"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-import","aliases":["cognition.import.enabled","group:cog-import/cognition.import.enabled"]},{"path":"cognition.import.maxBytes","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"import"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-import","aliases":["cognition.import.maxBytes","group:cog-import/cognition.import.maxBytes"]},{"path":"cognition.import.maxItems","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"import"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-import","aliases":["cognition.import.maxItems","group:cog-import/cognition.import.maxItems"]},{"path":"cognition.consolidation.enabled","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.consolidation.enabled","group:cog-memory/cognition.consolidation.enabled"]},{"path":"cognition.consolidation.hour","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.consolidation.hour","group:cog-memory/cognition.consolidation.hour"]},{"path":"cognition.consolidation.reflect","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.consolidation.reflect","group:cog-memory/cognition.consolidation.reflect"]},{"path":"cognition.consolidation.reflectMinEpisodes","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.consolidation.reflectMinEpisodes","group:cog-memory/cognition.consolidation.reflectMinEpisodes"]},{"path":"cognition.memory.retrievalTopK","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.memory.retrievalTopK","group:cog-memory/cognition.memory.retrievalTopK"]},{"path":"cognition.memory.maxContextChars","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.memory.maxContextChars","group:cog-memory/cognition.memory.maxContextChars"]},{"path":"cognition.memory.recencyWeight","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.memory.recencyWeight","group:cog-memory/cognition.memory.recencyWeight"]},{"path":"cognition.memory.importanceWeight","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.memory.importanceWeight","group:cog-memory/cognition.memory.importanceWeight"]},{"path":"cognition.memory.relevanceWeight","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.memory.relevanceWeight","group:cog-memory/cognition.memory.relevanceWeight"]},{"path":"cognition.memory.emotionWeight","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.memory.emotionWeight","group:cog-memory/cognition.memory.emotionWeight"]},{"path":"cognition.memory.relationshipWeight","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.memory.relationshipWeight","group:cog-memory/cognition.memory.relationshipWeight"]},{"path":"cognition.memory.associationWeight","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.memory.associationWeight","group:cog-memory/cognition.memory.associationWeight"]},{"path":"cognition.memory.recencyHalfLifeDays","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.memory.recencyHalfLifeDays","group:cog-memory/cognition.memory.recencyHalfLifeDays"]},{"path":"cognition.memory.forgetHalfLifeDays","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.memory.forgetHalfLifeDays","group:cog-memory/cognition.memory.forgetHalfLifeDays"]},{"path":"cognition.memory.consolidateEvery","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.memory.consolidateEvery","group:cog-memory/cognition.memory.consolidateEvery"]},{"path":"cognition.memory.semanticIndex","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.memory.semanticIndex","group:cog-memory/cognition.memory.semanticIndex"]},{"path":"cognition.memory.embedding.enabled","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.memory.embedding.enabled","group:cog-memory/cognition.memory.embedding.enabled"]},{"path":"cognition.memory.embedding.baseUrl","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.memory.embedding.baseUrl","group:cog-memory/cognition.memory.embedding.baseUrl"]},{"path":"cognition.memory.embedding.model","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.memory.embedding.model","group:cog-memory/cognition.memory.embedding.model"]},{"path":"cognition.memory.embedding.apiKeyEnv","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"secret-reference","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.memory.embedding.apiKeyEnv","group:cog-memory/cognition.memory.embedding.apiKeyEnv"]},{"path":"cognition.memory.embedding.weight","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"memories"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-memory","aliases":["cognition.memory.embedding.weight","group:cog-memory/cognition.memory.embedding.weight"]},{"path":"cognition.llm.mode","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"models"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-llm","aliases":["cognition.llm.mode","group:cog-llm/cognition.llm.mode"]},{"path":"cognition.llm.provider","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"models"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-llm","aliases":["cognition.llm.provider","group:cog-llm/cognition.llm.provider"]},{"path":"cognition.llm.model","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"models"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-llm","aliases":["cognition.llm.model","group:cog-llm/cognition.llm.model"]},{"path":"cognition.llm.reasoningEffort","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"models"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-llm","aliases":["cognition.llm.reasoningEffort","group:cog-llm/cognition.llm.reasoningEffort"]},{"path":"cognition.llm.temperature","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"models"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-llm","aliases":["cognition.llm.temperature","group:cog-llm/cognition.llm.temperature"]},{"path":"cognition.llm.analysisMaxTokens","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"models"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-llm","aliases":["cognition.llm.analysisMaxTokens","group:cog-llm/cognition.llm.analysisMaxTokens"]},{"path":"cognition.llm.composeMaxTokens","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"models"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-llm","aliases":["cognition.llm.composeMaxTokens","group:cog-llm/cognition.llm.composeMaxTokens"]},{"path":"cognition.llm.budgetScope","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"models"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-llm","aliases":["cognition.llm.budgetScope","group:cog-llm/cognition.llm.budgetScope"]},{"path":"cognition.llm.personaDailyTokenBudget","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"models"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-llm","aliases":["cognition.llm.personaDailyTokenBudget","group:cog-llm/cognition.llm.personaDailyTokenBudget"]},{"path":"cognition.modelRouting.privateDefault","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"models"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-llm","aliases":["cognition.modelRouting.privateDefault","group:cog-llm/cognition.modelRouting.privateDefault"]},{"path":"cognition.modelRouting.groupDefault","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"models"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-llm","aliases":["cognition.modelRouting.groupDefault","group:cog-llm/cognition.modelRouting.groupDefault"]},{"path":"cognition.modelRouting.routes","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"models"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-llm","aliases":["cognition.modelRouting.routes","group:cog-llm/cognition.modelRouting.routes"]},{"path":"cognition.llm.fallbackToDsh","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"models"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-llm","aliases":["cognition.llm.fallbackToDsh","group:cog-llm/cognition.llm.fallbackToDsh"]},{"path":"cognition.llm.timeoutMs","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"models"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-llm","aliases":["cognition.llm.timeoutMs","group:cog-llm/cognition.llm.timeoutMs"]},{"path":"cognition.llm.dailyTokenBudget","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"models"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-llm","aliases":["cognition.llm.dailyTokenBudget","group:cog-llm/cognition.llm.dailyTokenBudget"]},{"path":"cognition.llm.maxConcurrency","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"models"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-llm","aliases":["cognition.llm.maxConcurrency","group:cog-llm/cognition.llm.maxConcurrency"]},{"path":"cognition.llm.retry","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"models"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-llm","aliases":["cognition.llm.retry","group:cog-llm/cognition.llm.retry"]},{"path":"cognition.llm.cache","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"models"},"sensitivity":"public","apply":"next-use","exposure":"config-file","storage":"config.json","legacyGroup":"cog-llm","aliases":["cognition.llm.cache","group:cog-llm/cognition.llm.cache"]},{"path":"cognition.persona.traits.extraversion","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.traits.extraversion","group:cog-persona/cognition.persona.traits.extraversion"]},{"path":"cognition.persona.traits.openness","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.traits.openness","group:cog-persona/cognition.persona.traits.openness"]},{"path":"cognition.persona.traits.agreeableness","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.traits.agreeableness","group:cog-persona/cognition.persona.traits.agreeableness"]},{"path":"cognition.persona.traits.conscientiousness","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.traits.conscientiousness","group:cog-persona/cognition.persona.traits.conscientiousness"]},{"path":"cognition.persona.traits.emotionalSensitivity","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.traits.emotionalSensitivity","group:cog-persona/cognition.persona.traits.emotionalSensitivity"]},{"path":"cognition.persona.traits.humor","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.traits.humor","group:cog-persona/cognition.persona.traits.humor"]},{"path":"cognition.persona.traits.socialInitiative","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.traits.socialInitiative","group:cog-persona/cognition.persona.traits.socialInitiative"]},{"path":"cognition.persona.traits.caution","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.traits.caution","group:cog-persona/cognition.persona.traits.caution"]},{"path":"cognition.persona.traits.expressiveness","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.traits.expressiveness","group:cog-persona/cognition.persona.traits.expressiveness"]},{"path":"cognition.persona.traits.conflictApproach","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.traits.conflictApproach","group:cog-persona/cognition.persona.traits.conflictApproach"]},{"path":"cognition.persona.traits.riskTolerance","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.traits.riskTolerance","group:cog-persona/cognition.persona.traits.riskTolerance"]},{"path":"cognition.persona.traits.consistency","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.traits.consistency","group:cog-persona/cognition.persona.traits.consistency"]},{"path":"cognition.persona.style.formality","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.style.formality","group:cog-persona/cognition.persona.style.formality"]},{"path":"cognition.persona.style.verbosity","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.style.verbosity","group:cog-persona/cognition.persona.style.verbosity"]},{"path":"cognition.persona.style.emojiRate","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.style.emojiRate","group:cog-persona/cognition.persona.style.emojiRate"]},{"path":"cognition.persona.style.punctuation","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"config-file","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.style.punctuation","group:cog-persona/cognition.persona.style.punctuation"]},{"path":"cognition.persona.style.teasingBound","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.style.teasingBound","group:cog-persona/cognition.persona.style.teasingBound"]},{"path":"cognition.persona.style.warmth","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.style.warmth","group:cog-persona/cognition.persona.style.warmth"]},{"path":"cognition.persona.values","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.values","group:cog-persona/cognition.persona.values"]},{"path":"cognition.persona.profile.displayName","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"profile-editor","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.profile.displayName","group:cog-persona/cognition.persona.profile.displayName"]},{"path":"cognition.persona.profile.tagline","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"profile-editor","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.profile.tagline","group:cog-persona/cognition.persona.profile.tagline"]},{"path":"cognition.persona.profile.identity","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"profile-editor","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.profile.identity","group:cog-persona/cognition.persona.profile.identity"]},{"path":"cognition.persona.profile.background","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"profile-editor","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.profile.background","group:cog-persona/cognition.persona.profile.background"]},{"path":"cognition.persona.profile.personality","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"profile-editor","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.profile.personality","group:cog-persona/cognition.persona.profile.personality"]},{"path":"cognition.persona.profile.speakingStyle","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"profile-editor","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.profile.speakingStyle","group:cog-persona/cognition.persona.profile.speakingStyle"]},{"path":"cognition.persona.profile.likes","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"profile-editor","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.profile.likes","group:cog-persona/cognition.persona.profile.likes"]},{"path":"cognition.persona.profile.dislikes","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"profile-editor","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.profile.dislikes","group:cog-persona/cognition.persona.profile.dislikes"]},{"path":"cognition.persona.profile.boundaries","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"profile-editor","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.profile.boundaries","group:cog-persona/cognition.persona.profile.boundaries"]},{"path":"cognition.persona.profile.examples","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"profile-editor","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.profile.examples","group:cog-persona/cognition.persona.profile.examples"]},{"path":"cognition.persona.evolutionPerDay","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.evolutionPerDay","group:cog-persona/cognition.persona.evolutionPerDay"]},{"path":"cognition.persona.evolutionEnabled","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.evolutionEnabled","group:cog-persona/cognition.persona.evolutionEnabled"]},{"path":"cognition.persona.min","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"config-file","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.min","group:cog-persona/cognition.persona.min"]},{"path":"cognition.persona.max","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"persona"},"sensitivity":"private","apply":"next-use","exposure":"config-file","storage":"config.json","legacyGroup":"cog-persona","aliases":["cognition.persona.max","group:cog-persona/cognition.persona.max"]},{"path":"cognition.emotion.sensitivity","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"emotion"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-emotion","aliases":["cognition.emotion.sensitivity","group:cog-emotion/cognition.emotion.sensitivity"]},{"path":"cognition.emotion.regulation","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"emotion"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-emotion","aliases":["cognition.emotion.regulation","group:cog-emotion/cognition.emotion.regulation"]},{"path":"cognition.emotion.valenceHalfLifeMin","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"emotion"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-emotion","aliases":["cognition.emotion.valenceHalfLifeMin","group:cog-emotion/cognition.emotion.valenceHalfLifeMin"]},{"path":"cognition.emotion.arousalHalfLifeMin","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"emotion"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-emotion","aliases":["cognition.emotion.arousalHalfLifeMin","group:cog-emotion/cognition.emotion.arousalHalfLifeMin"]},{"path":"cognition.emotion.stressHalfLifeMin","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"emotion"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-emotion","aliases":["cognition.emotion.stressHalfLifeMin","group:cog-emotion/cognition.emotion.stressHalfLifeMin"]},{"path":"cognition.emotion.moodHalfLifeMin","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"emotion"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-emotion","aliases":["cognition.emotion.moodHalfLifeMin","group:cog-emotion/cognition.emotion.moodHalfLifeMin"]},{"path":"cognition.emotion.effectsEnabled","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"emotion"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-emotion","aliases":["cognition.emotion.effectsEnabled","group:cog-emotion/cognition.emotion.effectsEnabled"]},{"path":"cognition.relationship.learningRate","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"relationships"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-relationship","aliases":["cognition.relationship.learningRate","group:cog-relationship/cognition.relationship.learningRate"]},{"path":"cognition.relationship.trustRate","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"relationships"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-relationship","aliases":["cognition.relationship.trustRate","group:cog-relationship/cognition.relationship.trustRate"]},{"path":"cognition.relationship.intimacyRate","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"relationships"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-relationship","aliases":["cognition.relationship.intimacyRate","group:cog-relationship/cognition.relationship.intimacyRate"]},{"path":"cognition.relationship.conflictRise","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"relationships"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-relationship","aliases":["cognition.relationship.conflictRise","group:cog-relationship/cognition.relationship.conflictRise"]},{"path":"cognition.relationship.conflictDecay","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"relationships"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-relationship","aliases":["cognition.relationship.conflictDecay","group:cog-relationship/cognition.relationship.conflictDecay"]},{"path":"cognition.relationship.inertia","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"relationships"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-relationship","aliases":["cognition.relationship.inertia","group:cog-relationship/cognition.relationship.inertia"]},{"path":"cognition.relationship.repairThreshold","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"relationships"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-relationship","aliases":["cognition.relationship.repairThreshold","group:cog-relationship/cognition.relationship.repairThreshold"]},{"path":"cognition.policy.replyThreshold","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"policy"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-policy","aliases":["cognition.policy.replyThreshold","group:cog-policy/cognition.policy.replyThreshold"]},{"path":"cognition.policy.waitThreshold","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"policy"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-policy","aliases":["cognition.policy.waitThreshold","group:cog-policy/cognition.policy.waitThreshold"]},{"path":"cognition.policy.silenceThreshold","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"policy"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-policy","aliases":["cognition.policy.silenceThreshold","group:cog-policy/cognition.policy.silenceThreshold"]},{"path":"cognition.policy.addressedBoost","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"policy"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-policy","aliases":["cognition.policy.addressedBoost","group:cog-policy/cognition.policy.addressedBoost"]},{"path":"cognition.policy.groupPenalty","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"policy"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-policy","aliases":["cognition.policy.groupPenalty","group:cog-policy/cognition.policy.groupPenalty"]},{"path":"cognition.policy.epsilon","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"policy"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-policy","aliases":["cognition.policy.epsilon","group:cog-policy/cognition.policy.epsilon"]},{"path":"cognition.policy.dailyGlobalLimit","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"policy"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-policy","aliases":["cognition.policy.dailyGlobalLimit","group:cog-policy/cognition.policy.dailyGlobalLimit"]},{"path":"cognition.policy.perChatPrivate","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"policy"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-policy","aliases":["cognition.policy.perChatPrivate","group:cog-policy/cognition.policy.perChatPrivate"]},{"path":"cognition.policy.perChatGroup","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"policy"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-policy","aliases":["cognition.policy.perChatGroup","group:cog-policy/cognition.policy.perChatGroup"]},{"path":"cognition.policy.maxConsecutiveBotMessages","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"policy"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-policy","aliases":["cognition.policy.maxConsecutiveBotMessages","group:cog-policy/cognition.policy.maxConsecutiveBotMessages"]},{"path":"cognition.policy.proactive","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"policy"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-policy","aliases":["cognition.policy.proactive","group:cog-policy/cognition.policy.proactive"]},{"path":"cognition.policy.groupAmbient","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"policy"},"sensitivity":"public","apply":"next-use","exposure":"config-file","storage":"config.json","legacyGroup":"cog-policy","aliases":["cognition.policy.groupAmbient","group:cog-policy/cognition.policy.groupAmbient"]},{"path":"cognition.policy.analyzeWithLlm","ownerClass":"profile","scope":"profile","canonical":{"area":"profiles","section":"policy"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-policy","aliases":["cognition.policy.analyzeWithLlm","group:cog-policy/cognition.policy.analyzeWithLlm"]},{"path":"cognition.learning.enabled","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-learning","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-learning","aliases":["cognition.learning.enabled","group:cog-learning/cognition.learning.enabled"]},{"path":"cognition.learning.autoResearch","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-learning","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-learning","aliases":["cognition.learning.autoResearch","group:cog-learning/cognition.learning.autoResearch"]},{"path":"cognition.learning.detectUnknowns","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-learning","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-learning","aliases":["cognition.learning.detectUnknowns","group:cog-learning/cognition.learning.detectUnknowns"]},{"path":"cognition.learning.maxTasksPerHour","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-learning","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-learning","aliases":["cognition.learning.maxTasksPerHour","group:cog-learning/cognition.learning.maxTasksPerHour"]},{"path":"cognition.learning.maxQueries","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-learning","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-learning","aliases":["cognition.learning.maxQueries","group:cog-learning/cognition.learning.maxQueries"]},{"path":"cognition.learning.maxSources","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-learning","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-learning","aliases":["cognition.learning.maxSources","group:cog-learning/cognition.learning.maxSources"]},{"path":"cognition.learning.dailyTokenBudget","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-learning","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-learning","aliases":["cognition.learning.dailyTokenBudget","group:cog-learning/cognition.learning.dailyTokenBudget"]},{"path":"cognition.learning.taskTtlHours","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-learning","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-learning","aliases":["cognition.learning.taskTtlHours","group:cog-learning/cognition.learning.taskTtlHours"]},{"path":"cognition.learning.retry","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-learning","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-learning","aliases":["cognition.learning.retry","group:cog-learning/cognition.learning.retry"]},{"path":"cognition.learning.minConfidence","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-learning","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-learning","aliases":["cognition.learning.minConfidence","group:cog-learning/cognition.learning.minConfidence"]},{"path":"cognition.learning.sources.web","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-learning","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-learning","aliases":["cognition.learning.sources.web","group:cog-learning/cognition.learning.sources.web"]},{"path":"cognition.learning.sources.wikipedia","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-learning","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-learning","aliases":["cognition.learning.sources.wikipedia","group:cog-learning/cognition.learning.sources.wikipedia"]},{"path":"cognition.learning.sources.openalex","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-learning","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-learning","aliases":["cognition.learning.sources.openalex","group:cog-learning/cognition.learning.sources.openalex"]},{"path":"cognition.learning.sources.github","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-learning","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-learning","aliases":["cognition.learning.sources.github","group:cog-learning/cognition.learning.sources.github"]},{"path":"cognition.learning.sources.rss","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-learning","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-learning","aliases":["cognition.learning.sources.rss","group:cog-learning/cognition.learning.sources.rss"]},{"path":"cognition.learning.sources.local","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-learning","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-learning","aliases":["cognition.learning.sources.local","group:cog-learning/cognition.learning.sources.local"]},{"path":"cognition.proactivity.enabled","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-proactivity","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-proactivity","aliases":["cognition.proactivity.enabled","group:cog-proactivity/cognition.proactivity.enabled"]},{"path":"cognition.proactivity.quietStart","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-proactivity","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-proactivity","aliases":["cognition.proactivity.quietStart","group:cog-proactivity/cognition.proactivity.quietStart"]},{"path":"cognition.proactivity.quietEnd","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-proactivity","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-proactivity","aliases":["cognition.proactivity.quietEnd","group:cog-proactivity/cognition.proactivity.quietEnd"]},{"path":"cognition.proactivity.maxPrivatePerDay","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-proactivity","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-proactivity","aliases":["cognition.proactivity.maxPrivatePerDay","group:cog-proactivity/cognition.proactivity.maxPrivatePerDay"]},{"path":"cognition.proactivity.maxGroupPerDay","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-proactivity","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-proactivity","aliases":["cognition.proactivity.maxGroupPerDay","group:cog-proactivity/cognition.proactivity.maxGroupPerDay"]},{"path":"cognition.proactivity.minFamiliarity","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-proactivity","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-proactivity","aliases":["cognition.proactivity.minFamiliarity","group:cog-proactivity/cognition.proactivity.minFamiliarity"]},{"path":"cognition.proactivity.backoffHours","ownerClass":"module","scope":"system","canonical":{"area":"extensions","section":"module","moduleId":"builtin-proactivity","anchor":"ob-module-config"},"sensitivity":"public","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-proactivity","aliases":["cognition.proactivity.backoffHours","group:cog-proactivity/cognition.proactivity.backoffHours"]},{"path":"cognition.privacy.privateIsolation","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"privacy"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-privacy","aliases":["cognition.privacy.privateIsolation","group:cog-privacy/cognition.privacy.privateIsolation"]},{"path":"cognition.privacy.learnFromPrivate","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"privacy"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-privacy","aliases":["cognition.privacy.learnFromPrivate","group:cog-privacy/cognition.privacy.learnFromPrivate"]},{"path":"cognition.privacy.rawRetentionDays","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"privacy"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-privacy","aliases":["cognition.privacy.rawRetentionDays","group:cog-privacy/cognition.privacy.rawRetentionDays"]},{"path":"cognition.privacy.traceRetentionDays","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"privacy"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-privacy","aliases":["cognition.privacy.traceRetentionDays","group:cog-privacy/cognition.privacy.traceRetentionDays"]},{"path":"cognition.privacy.decisionRetentionDays","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"privacy"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-privacy","aliases":["cognition.privacy.decisionRetentionDays","group:cog-privacy/cognition.privacy.decisionRetentionDays"]},{"path":"cognition.privacy.metricsRetentionDays","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"privacy"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-privacy","aliases":["cognition.privacy.metricsRetentionDays","group:cog-privacy/cognition.privacy.metricsRetentionDays"]},{"path":"cognition.privacy.exportSecret","ownerClass":"system","scope":"system","canonical":{"area":"data","section":"privacy"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-privacy","aliases":["cognition.privacy.exportSecret","group:cog-privacy/cognition.privacy.exportSecret"]},{"path":"cognition.debug.trace","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"diagnostics"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-core","aliases":["cognition.debug.trace","group:cog-core/cognition.debug.trace"]},{"path":"cognition.debug.keepPrompt","ownerClass":"system","scope":"system","canonical":{"area":"system","section":"diagnostics"},"sensitivity":"private","apply":"next-use","exposure":"panel","storage":"config.json","legacyGroup":"cog-core","aliases":["cognition.debug.keepPrompt","group:cog-core/cognition.debug.keepPrompt"]},{"path":"modules.builtin-sample.message","ownerClass":"module","scope":"module","canonical":{"area":"extensions","section":"module","moduleId":"builtin-sample","anchor":"ob-module-config"},"sensitivity":"private","apply":"next-use","exposure":"module-schema","storage":"module-file","legacyGroup":null,"aliases":["modules.builtin-sample.message","module:builtin-sample/message"]}]
    const isCanonicalDestination = target => NAVIGATION_REGISTRY.some(area => area.id === target?.area && area.sections.some(section => section.id === target.section))
    // Shared normalization for the WebUI and legacy feature links.

    const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/
    const fieldAliases = new Map(SETTINGS_FIELDS.flatMap(field => field.aliases.map(alias => [
      alias, { ...field.canonical, fieldPath: field.path },
    ])))
    const own = (object, key) => Object.hasOwn(object, key) ? object[key] : undefined
    const copy = target => target ? { ...target } : null
    const fallback = () => ({ ...DEFAULT_TARGET })

    /** Unambiguous namespaces are preferred; bare names prefer tabs, then groups. */
    function resolveAlias(value) {
      if (typeof value !== 'string' || !value) return null
      const id = value.startsWith('#') ? value.slice(1) : value
      return copy(own(LEGACY_ALIASES, id) || fieldAliases.get(id)
        || own(LEGACY_TABS, id) || own(LEGACY_CONFIG_GROUPS, id)
        || own(LEGACY_COGNITION_SECTIONS, id)
        || (LEGACY_MODULE_IDS.includes(id) ? LEGACY_ALIASES[`module:${id}`] : null)
        || dynamicAnchor(id))
    }

    function dynamicAnchor(anchor) {
      const match = /^(ob-cog-(decision|task)-)(.+)$/.exec(anchor)
      if (!match || !ID.test(anchor) || !ID.test(match[3])) return null
      return {
        area: 'profiles', section: match[2] === 'decision' ? 'policy' : 'learning',
        anchor, [match[2] === 'decision' ? 'decisionId' : 'taskId']: match[3],
      }
    }

    function samePlace(a, b) {
      return a.area === b.area && a.section === b.section
        && (!a.moduleId || !b.moduleId || a.moduleId === b.moduleId)
    }

    function normalize(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return null
      const allowed = ['tab', 'area', 'section', 'moduleId', 'anchor', 'decisionId', 'taskId', 'fieldPath']
      if (Object.keys(input).some(key => !allowed.includes(key))) return null
      for (const key of allowed) {
        if (input[key] != null && input[key] !== '' && (typeof input[key] !== 'string'
          || (key !== 'fieldPath' && !ID.test(input[key])))) return null
      }
      const canonical = Boolean(input.area)
      const legacyTab = input.tab?.replace(/^(?:tab:|ob-tab-|ob-panel-)/, '')
      if (canonical && input.tab) return null
      let target = canonical
        ? { area: input.area, section: input.section || NAVIGATION_REGISTRY.find(area => area.id === input.area)?.sections[0].id }
        : resolveAlias(input.tab)
      if (!target) return null

      // Legacy section names live in their tab's namespace. A section may be a
      // config group, whose landing destination can belong to another area.
      if (!canonical && input.section) {
        const tab = legacyTab
        let sectionTarget
        if (tab === 'cognition') sectionTarget = own(LEGACY_COGNITION_SECTIONS, input.section)
          || (input.section.startsWith('cog-') && own(LEGACY_CONFIG_GROUPS, input.section))
        else if (tab === 'config') sectionTarget = own(LEGACY_CONFIG_GROUPS, input.section)
        else if (tab === 'settings') sectionTarget = own(LEGACY_SETTINGS_SECTIONS, input.section)
        else if (tab === 'modules' && ['detail', 'config', 'panel', 'reminders'].includes(input.section)) {
          sectionTarget = { area: 'extensions', section: 'module', anchor: `ob-module-${input.section}` }
        } else if (tab === 'media' && input.section === 'stickers') sectionTarget = LEGACY_ANCHORS['ob-media-stickers']
        if (!sectionTarget) return null
        target = { ...sectionTarget }
      }
      if (!isCanonicalDestination(target)) return null

      if (input.moduleId) {
        if (target.area !== 'extensions' || !['modules', 'module'].includes(target.section)
          || (target.moduleId && target.moduleId !== input.moduleId)) return null
        target = { ...target, section: 'module', moduleId: input.moduleId }
      }

      if (input.fieldPath) {
        const field = fieldAliases.get(input.fieldPath)
        if (!field || (canonical && !samePlace(target, field))
          || (input.moduleId && input.moduleId !== field.moduleId)) return null
        target = { ...field }
      }

      if (input.anchor) {
        const anchor = input.anchor
        // Old resolveLegacyGo('cognition', group) used section=settings, anchor=cog-*.
        const group = own(LEGACY_CONFIG_GROUPS, anchor)
        if (group && !canonical && (legacyTab === 'config'
          || (legacyTab === 'cognition' && (!input.section || input.section === 'settings')))) {
          target = { ...group }
        } else {
          const prefixed = anchor.startsWith('ob-') ? anchor
            : target.area === 'extensions' ? `ob-module-${anchor}`
              : target.area === 'profiles' ? `ob-cog-${anchor}`
                : target.area === 'data' && target.section === 'media' ? `ob-media-${anchor}` : anchor
          const anchorTarget = own(LEGACY_ANCHORS, prefixed) || dynamicAnchor(prefixed)
          if (anchorTarget) {
            // An unqualified cognition link may infer its subsection from the anchor.
            const infer = !canonical && legacyTab === 'cognition' && !input.section
            if (!infer && !samePlace(target, anchorTarget)) return null
            target = { ...target, ...anchorTarget, ...(target.moduleId ? { moduleId: target.moduleId } : {}) }
          } else if (target.area === 'system' && target.section === 'appearance'
            && own(LEGACY_SETTINGS_SECTIONS, anchor)) target.anchor = anchor
          else return null
        }
      }

      if (input.decisionId && input.taskId) return null
      for (const [key, section] of [['decisionId', 'policy'], ['taskId', 'learning']]) {
        if (!input[key]) continue
        if (target.area !== 'profiles' || (target.section !== section
          && (canonical || input.section || input.anchor))) return null
        if (target[key] && target[key] !== input[key]) return null
        target = { ...target, section, [key]: input[key] }
      }
      if (target.area === 'extensions' && target.section === 'module') {
        // Generic module anchors are templates; selecting a concrete module is
        // required before scrolling. External local module IDs remain opaque.
        if (!target.moduleId) return null
        if (!target.anchor) target.anchor = 'ob-module-detail'
        if (['detail', 'config', 'panel', 'reminders'].includes(target.anchor)) target.anchor = `ob-module-${target.anchor}`
      }
      // Later aliases must not silently replace an explicitly selected identity.
      if (input.moduleId && target.moduleId !== input.moduleId) return null
      if (input.fieldPath) {
        const field = fieldAliases.get(input.fieldPath)
        if (!samePlace(target, field)) return null
        target.fieldPath = field.fieldPath
      }
      return target
    }

    /** Unknown/malformed input returns Overview, with no stale IDs or side effects. */
    function goTo(target) {
      try { return normalize(target) || fallback() } catch { return fallback() }
    }

    /** Compatibility with both resolveLegacyGo(tab) and resolveLegacyGo(tab, configGroup). */
    function resolveLegacyGo(id, group = '') {
      if (typeof id !== 'string' || typeof group !== 'string') return fallback()
      if (!group) {
        const alias = resolveAlias(id)
        return alias ? goTo(alias) : fallback()
      }
      return goTo({ tab: id, ...(id === 'cognition' && group.startsWith('cog-')
        ? { section: 'settings', anchor: group } : { section: group }) })
    }

    const normalizeNavigation = goTo


    // Only this query parameter belongs to the panel. The host path/hash/state stay intact.
    const NAVIGATION_PARAM = 'ob-nav'
    function readNavigationUrl(href) {
      try {
        const url = new URL(href, 'http://localhost')
        const value = url.searchParams.get(NAVIGATION_PARAM)
        if (value !== null) return goTo(JSON.parse(value))
        return resolveLegacyGo(decodeURIComponent(url.hash.slice(1)))
      } catch { return fallback() }
    }
    function navigationUrl(href, target) {
      const url = new URL(href, 'http://localhost')
      url.searchParams.set(NAVIGATION_PARAM, JSON.stringify(goTo(target)))
      return url.pathname + url.search + url.hash
    }
    function createNavigationHistory(host, onChange) {
      const read = () => onChange(readNavigationUrl(host.location.href))
      host.addEventListener('popstate', read)
      host.addEventListener('hashchange', read)
      return {
        navigate(input) {
          const target = goTo(input)
          host.history.pushState(host.history.state, '', navigationUrl(host.location.href, target))
          onChange(target)
          return target
        },
        dispose() {
          host.removeEventListener('popstate', read)
          host.removeEventListener('hashchange', read)
        },
      }
    }

    // Metadata is explicitly projected: neither current settings nor defaults enter search.
    function navigationSearchIndex(labels = {}) {
      const rows = NAVIGATION_REGISTRY.flatMap(area => area.sections
        .filter(section => section.id !== 'module' && !(area.id === 'profiles' && section.id === 'settings'))
        .map(section => ({ label: area.label + ' / ' + (labels[section.id] || section.id), target: { area: area.id, section: section.id }, terms: area.label + ' ' + section.id + ' ' + (labels[section.id] || '') })))
      for (const [alias, target] of Object.entries(LEGACY_ALIASES)) {
        if (target.section === 'module' && !target.moduleId) continue
        const row = rows.find(row => samePlace(row.target, target))
        if (row) row.terms += ' ' + alias + ' ' + (labels[alias.replace(/^tab:/, '')] || '')
        else rows.push({ label: labels[alias] || alias, target: goTo(target), terms: alias + ' ' + (labels[alias] || '') })
      }
      for (const field of SETTINGS_FIELDS) rows.push({
        label: labels[field.path] || field.path, target: { ...field.canonical, fieldPath: field.path },
        terms: [field.path, labels[field.path] || '', field.legacyGroup || '', labels['group:' + field.legacyGroup] || '', ...field.aliases].join(' '),
      })
      return rows
    }
    function searchNavigation(query, labels = {}) {
      const terms = typeof query === 'string' ? query.trim().toLowerCase().split(/\s+/).filter(Boolean) : []
      return terms.length ? navigationSearchIndex(labels).filter(row => terms.every(term => (row.label + ' ' + row.terms).toLowerCase().includes(term))) : []
    }

    // END SHARED NAVIGATION

    function clone(value) {
      if (value === undefined) return undefined
      try {
        return JSON.parse(JSON.stringify(value))
      } catch (error) {
        return value
      }
    }

    function isPlainObject(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value)
    }

    function safeArray(value) {
      return Array.isArray(value) ? value : []
    }

    function safeObject(value) {
      return isPlainObject(value) ? value : {}
    }

    /** 深比较：对象/数组递归；其余用 ===（NaN 视作相等）。 */
    function deepEqual(a, b) {
      if (a === b) return true
      if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return true
      if (a == null || b == null) return a == null && b == null
      if (typeof a !== 'object' || typeof b !== 'object') return false
      const aIsArray = Array.isArray(a)
      const bIsArray = Array.isArray(b)
      if (aIsArray !== bIsArray) return false
      if (aIsArray) {
        if (a.length !== b.length) return false
        for (let i = 0; i < a.length; i += 1) if (!deepEqual(a[i], b[i])) return false
        return true
      }
      const aKeys = Object.keys(a)
      const bKeys = Object.keys(b)
      if (aKeys.length !== bKeys.length) return false
      for (const key of aKeys) {
        if (!Object.prototype.hasOwnProperty.call(b, key)) return false
        if (!deepEqual(a[key], b[key])) return false
      }
      return true
    }

    function getByPath(obj, path) {
      const keys = String(path == null ? '' : path).split('.')
      let cur = obj
      for (const key of keys) {
        if (cur == null) return undefined
        cur = cur[key]
      }
      return cur
    }

    /** 纯函数写路径：返回新对象，不修改入参。 */
    function setByPath(obj, path, value) {
      const root = clone(isPlainObject(obj) ? obj : {})
      const keys = String(path == null ? '' : path).split('.').filter((key) => key !== '')
      if (!keys.length) return root
      let cur = root
      for (let i = 0; i < keys.length - 1; i += 1) {
        const key = keys[i]
        if (!isPlainObject(cur[key])) cur[key] = {}
        cur = cur[key]
      }
      cur[keys[keys.length - 1]] = value
      return root
    }

    function clampNumber(value, min, max, fallback) {
      const n = Number(value)
      if (!Number.isFinite(n)) return fallback
      const lo = Number.isFinite(Number(min)) ? Number(min) : -Infinity
      const hi = Number.isFinite(Number(max)) ? Number(max) : Infinity
      return Math.min(hi, Math.max(lo, n))
    }

    function pad2(n) {
      return String(n).padStart(2, '0')
    }

    function toDate(value) {
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        // OneBot 事件的 time 是 Unix 秒；宿主内部时间戳是毫秒。小于 1e12 的按秒处理。
        const d = new Date(value < 1e12 ? value * 1000 : value)
        return Number.isNaN(d.getTime()) ? null : d
      }
      if (typeof value === 'string' && value.trim()) {
        const d = new Date(value)
        return Number.isNaN(d.getTime()) ? null : d
      }
      return null
    }

    function formatTime(value) {
      const d = toDate(value)
      if (!d) return '—'
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
    }

    function formatDateTime(value) {
      const d = toDate(value)
      if (!d) return '—'
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + formatTime(d)
    }

    function formatDuration(ms) {
      const n = Number(ms)
      if (!Number.isFinite(n) || n < 0) return '—'
      if (n < 1000) return Math.round(n) + ' 毫秒'
      const totalSeconds = Math.floor(n / 1000)
      if (totalSeconds < 60) return totalSeconds + ' 秒'
      const totalMinutes = Math.floor(totalSeconds / 60)
      if (totalMinutes < 60) return totalMinutes + ' 分 ' + (totalSeconds % 60) + ' 秒'
      const totalHours = Math.floor(totalMinutes / 60)
      if (totalHours < 24) return totalHours + ' 小时 ' + (totalMinutes % 60) + ' 分'
      return Math.floor(totalHours / 24) + ' 天 ' + (totalHours % 24) + ' 小时'
    }

    function formatRelative(value, now) {
      const d = toDate(value)
      if (!d) return '—'
      const base = Number.isFinite(Number(now)) ? Number(now) : Date.now()
      const diff = base - d.getTime()
      if (diff < 0) return '刚刚'
      if (diff < 60000) return '刚刚'
      if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
      if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
      if (diff < 30 * 86400000) return Math.floor(diff / 86400000) + ' 天前'
      return formatDateTime(d)
    }

    function truncateText(text, max) {
      const value = String(text == null ? '' : text)
      const limit = Number.isFinite(Number(max)) ? Number(max) : 200
      if (value.length <= limit) return value
      return value.slice(0, Math.max(1, limit - 1)) + '…'
    }

    /** 端点脱敏：去掉账号密码与 token 类查询参数的值。 */
    function maskEndpoint(value) {
      const raw = String(value == null ? '' : value).trim()
      if (!raw) return ''
      let url = null
      try {
        url = new URL(raw)
      } catch (error) {
        url = null
      }
      if (!url) return raw.replace(/([?&](?:access_token|token|key|secret|password)=)[^&#]*/gi, '$1***')
      const path = url.pathname && url.pathname !== '/' ? url.pathname : ''
      const query = []
      url.searchParams.forEach((paramValue, key) => {
        query.push(key + '=' + (/(token|key|secret|password|auth)/i.test(key) ? '***' : paramValue))
      })
      return url.protocol + '//' + url.host + path + (query.length ? '?' + query.join('&') : '')
    }

    function buildQuery(params) {
      const source = isPlainObject(params) ? params : {}
      const parts = []
      Object.keys(source).forEach((key) => {
        const value = source[key]
        if (value === undefined || value === null || value === '') return
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)))
      })
      return parts.length ? '?' + parts.join('&') : ''
    }

    function formatApiError(payload, fallback) {
      const source = safeObject(payload)
      const message = source.message == null ? '' : String(source.message).trim()
      if (message) return message
      return fallback || '操作失败'
    }

    /** 统一处理宿主 { ok:false, message } 与网络错误。 */
    function parseApiResponse(payload) {
      if (payload == null) return { ok: false, message: '没有收到插件响应', data: null }
      if (typeof payload !== 'object') return { ok: false, message: '插件返回了无法识别的内容', data: null }
      if (payload.ok === false) return { ok: false, message: formatApiError(payload, '操作失败'), data: null }
      return { ok: true, message: payload.message == null ? '' : String(payload.message), data: payload }
    }

    /** POST /config/save 与 /config/reset 的返回形状。 */
    function mergeConfigSave(payload) {
      const parsed = parseApiResponse(payload)
      if (!parsed.ok) return { ok: false, config: null, issues: [], message: parsed.message }
      const data = safeObject(parsed.data)
      const config = isPlainObject(data.config) ? data.config : null
      const issues = safeArray(data.issues).map((item) => String(item)).filter(Boolean)
      return { ok: true, config, issues, message: parsed.message }
    }

    const FIELD_TYPES = ['switch', 'text', 'secret', 'number', 'select', 'string-list', 'number-list', 'textarea']

    function normalizeFieldSpec(field) {
      if (!isPlainObject(field)) return null
      const path = typeof field.path === 'string' ? field.path.trim() : ''
      if (!path) return null
      const type = FIELD_TYPES.indexOf(field.type) >= 0 ? field.type : 'text'
      const spec = {
        path,
        type,
        label: typeof field.label === 'string' && field.label.trim() ? field.label : path,
      }
      if (typeof field.module === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(field.module)) spec.module = field.module
      if (Object.prototype.hasOwnProperty.call(field, 'default')) spec.default = clone(field.default)
      if (field.help != null && String(field.help).trim()) spec.help = String(field.help)
      if (field.placeholder != null && String(field.placeholder).trim()) spec.placeholder = String(field.placeholder)
      if (field.unit != null && String(field.unit).trim()) spec.unit = String(field.unit)
      if (type === 'number') {
        if (Number.isFinite(Number(field.min))) spec.min = Number(field.min)
        if (Number.isFinite(Number(field.max))) spec.max = Number(field.max)
        if (Number.isFinite(Number(field.step))) spec.step = Number(field.step)
      }
      if (type === 'select') {
        spec.options = safeArray(field.options)
          .filter((option) => isPlainObject(option) && option.value !== undefined)
          .map((option) => ({
            value: String(option.value),
            label: option.label != null ? String(option.label) : String(option.value),
          }))
      }
      return spec
    }

    /** groups（服务端字段表）→ 可渲染的规格；非法字段降级或跳过。 */
    function buildFieldSpecs(groups) {
      if (!Array.isArray(groups)) return []
      const out = []
      groups.forEach((group, index) => {
        if (!isPlainObject(group)) return
        const fields = safeArray(group.fields).map(normalizeFieldSpec).filter(Boolean)
        if (!fields.length) return
        out.push({
          id: typeof group.id === 'string' && group.id ? group.id : 'group-' + index,
          title: typeof group.title === 'string' && group.title ? group.title : '配置',
          description: typeof group.description === 'string' ? group.description : '',
          fields,
        })
      })
      return out
    }

    function systemFieldSpecs(groups) {
      return buildFieldSpecs(groups)
        .map((group) => ({ ...group, fields: group.fields.filter((field) => !field.module) }))
        .filter((group) => group.fields.length)
    }

    function flattenFieldSpecs(groups) {
      return buildFieldSpecs(groups).reduce((acc, group) => acc.concat(group.fields), [])
    }

    function fieldSpecByPath(groups, path) {
      const target = String(path == null ? '' : path)
      return flattenFieldSpecs(groups).find((field) => field.path === target) || null
    }

    function defaultsFromGroups(groups) {
      let out = {}
      flattenFieldSpecs(groups).forEach((field) => {
        if (!Object.prototype.hasOwnProperty.call(field, 'default')) return
        out = setByPath(out, field.path, clone(field.default))
      })
      return out
    }

    /** 刷新间隔：优先 config.ui.refreshMs，缺省时取服务端字段表 default，最后才用兜底值。 */
    function computeRefreshMs(config, groups, fallbackMs) {
      const fallback = Number.isFinite(Number(fallbackMs)) ? Number(fallbackMs) : 2000
      let raw = getByPath(isPlainObject(config) ? config : {}, 'ui.refreshMs')
      if (raw === undefined || raw === null || raw === '') {
        const spec = fieldSpecByPath(groups, 'ui.refreshMs')
        raw = spec && Object.prototype.hasOwnProperty.call(spec, 'default') ? spec.default : undefined
      }
      const value = Number(raw)
      if (!Number.isFinite(value)) return fallback
      return clampNumber(value, REFRESH_MIN, REFRESH_MAX, fallback)
    }

    const STATE_LABELS = {
      connected: { text: '已连接', tone: 'ok' },
      connecting: { text: '连接中', tone: 'warn' },
      disconnected: { text: '已断开', tone: 'err' },
      stopped: { text: '已停止', tone: 'dim' },
      unconfigured: { text: '未配置', tone: 'warn' },
      paused: { text: '已暂停', tone: 'err' },
    }

    function stateLabel(state) {
      const key = String(state == null ? '' : state)
      return STATE_LABELS[key] || { text: key || '未知', tone: 'dim' }
    }

    function loginCheckLabel(check) {
      switch (String(check == null ? '' : check)) {
        case 'ok':
          return { text: '核验通过', tone: 'ok' }
        case 'mismatch':
          return { text: '账号不一致', tone: 'err' }
        case 'error':
          return { text: '核验失败', tone: 'err' }
        case 'pending':
          return { text: '等待核验', tone: 'warn' }
        case 'off':
          return { text: '未开启核验', tone: 'dim' }
        default:
          return { text: '未知', tone: 'dim' }
      }
    }

    function endpointModeLabel(mode) {
      return mode === 'snowluma' ? '从 SnowLuma 读取' : mode === 'onebot' ? 'OneBot 地址' : '未设置'
    }

    function accountCheckLabel(value) {
      if (value === 'enforce') return '断开并暂停自动重连'
      if (value === 'off') return '不检查'
      if (value === 'warn') return '只警告'
      return String(value == null ? '' : value) || '—'
    }

    function eventKindLabel(kind) {
      switch (String(kind == null ? '' : kind)) {
        case 'message':
          return '消息'
        case 'notice':
          return '通知'
        case 'request':
          return '请求'
        case 'meta_event':
          return '元事件'
        case 'unknown':
          return '未知'
        default:
          return String(kind == null ? '' : kind) || '未知'
      }
    }

    function segmentText(segment) {
      if (!isPlainObject(segment)) return ''
      const data = isPlainObject(segment.data) ? segment.data : segment
      if (segment.type === 'text' || (data.text !== undefined && segment.type !== 'image')) {
        return String(data.text == null ? '' : data.text)
      }
      if (segment.type === 'at') return '@' + String(data.qq || data.name || '')
      if (segment.type === 'image') return '[图片]'
      if (segment.type === 'face') return '[表情]'
      if (segment.type === 'record') return '[语音]'
      if (segment.type === 'video') return '[视频]'
      if (segment.type === 'file') return '[文件]'
      if (segment.type === 'reply') return ''
      return segment.type ? '[' + String(segment.type) + ']' : ''
    }

    function noticeSummary(notice) {
      const source = safeObject(notice)
      const parts = []
      if (source.type) parts.push(String(source.type))
      if (source.subType) parts.push(String(source.subType))
      if (source.groupId) parts.push('群 ' + String(source.groupId))
      if (source.userId) parts.push('用户 ' + String(source.userId))
      if (source.targetId) parts.push('目标 ' + String(source.targetId))
      return parts.length ? '[通知] ' + parts.join(' · ') : '[通知]'
    }

    function requestSummary(request) {
      const source = safeObject(request)
      const parts = []
      if (source.type) parts.push(String(source.type))
      if (source.subType) parts.push(String(source.subType))
      if (source.groupId) parts.push('群 ' + String(source.groupId))
      if (source.userId) parts.push('用户 ' + String(source.userId))
      if (source.comment) parts.push(String(source.comment))
      return parts.length ? '[请求] ' + parts.join(' · ') : '[请求]'
    }

    function metaSummary(meta) {
      const source = safeObject(meta)
      const parts = []
      if (source.type) parts.push(String(source.type))
      if (source.subType) parts.push(String(source.subType))
      return parts.length ? '[元事件] ' + parts.join(' · ') : '[元事件]'
    }

    /** 规范化事件 → 展示用结构（不伪造字段，缺什么就留空）。 */
    function describeEvent(event) {
      const source = safeObject(event)
      const kind = typeof source.kind === 'string' && source.kind ? source.kind : 'unknown'
      const message = isPlainObject(source.message) ? source.message : null
      const notice = isPlainObject(source.notice) ? source.notice : null
      const request = isPlainObject(source.request) ? source.request : null
      const meta = isPlainObject(source.meta) ? source.meta : null
      const sender = message && isPlainObject(message.sender) ? message.sender : null
      const segments = message ? safeArray(message.segments) : []
      const mentions = message ? safeArray(message.mentions) : []
      const images = message ? safeArray(message.images) : []
      let chatType = ''
      let chatId = ''
      if (message) {
        chatType = message.chatType === 'group' ? 'group' : message.chatType === 'private' ? 'private' : ''
        chatId = String(message.chatId == null ? '' : message.chatId)
      } else if (notice && notice.groupId) {
        chatType = 'group'
        chatId = String(notice.groupId)
      }
      let text = ''
      if (message && typeof message.text === 'string') text = message.text
      if (!text && segments.length) text = segments.map(segmentText).filter(Boolean).join('')
      let summary = ''
      if (kind === 'message') summary = text || (images.length ? '[图片 × ' + images.length + ']' : '')
      else if (kind === 'notice') summary = noticeSummary(notice)
      else if (kind === 'request') summary = requestSummary(request)
      else if (kind === 'meta_event') summary = metaSummary(meta)
      else summary = text || eventKindLabel(kind)
      return {
        seq: Number.isFinite(Number(source.seq)) ? Number(source.seq) : undefined,
        time: formatTime(source.time != null ? source.time : source.receivedAt),
        kind,
        kindLabel: eventKindLabel(kind),
        chatType,
        chatId,
        chatLabel: chatType === 'group' ? '群 ' + (chatId || '?') : chatType === 'private' ? '私聊 ' + (chatId || '?') : '',
        senderName: sender ? String(sender.nickname || sender.card || sender.userId || '') : '',
        segments,
        mentions,
        images,
        summary: truncateText(summary, 240),
        fullText: String(summary || ''),
      }
    }

    function normalizeFriend(item) {
      const source = safeObject(item)
      const id = String(source.user_id != null ? source.user_id : source.userId != null ? source.userId : '')
      return {
        id,
        name: String(source.remark || source.nickname || source.card || id || ''),
        nickname: String(source.nickname || ''),
        remark: String(source.remark || ''),
      }
    }

    function normalizeGroup(item) {
      const source = safeObject(item)
      const id = String(source.group_id != null ? source.group_id : source.groupId != null ? source.groupId : '')
      const memberCount = Number(source.member_count != null ? source.member_count : source.memberCount)
      return {
        id,
        name: String(source.group_name || source.groupName || id || ''),
        memberCount: Number.isFinite(memberCount) ? memberCount : null,
      }
    }

    function normalizeLogEntry(entry) {
      const source = safeObject(entry)
      const level = LOG_LEVELS.indexOf(source.level) >= 0 ? source.level : 'info'
      return {
        seq: Number.isFinite(Number(source.seq)) ? Number(source.seq) : undefined,
        time: source.time != null && String(source.time).trim() ? String(source.time) : formatTime(source.t),
        level,
        area: source.area == null ? '' : String(source.area),
        text: source.text == null ? '' : String(source.text),
      }
    }

    /** 增量合并：按 seq 去重并升序（宿主 /events、/logs 都带自增 seq）。 */
    function mergeIncremental(previous, incoming) {
      const map = new Map()
      safeArray(previous).forEach((item) => {
        if (isPlainObject(item) && Number.isFinite(Number(item.seq))) map.set(Number(item.seq), item)
      })
      safeArray(incoming).forEach((item) => {
        if (isPlainObject(item) && Number.isFinite(Number(item.seq))) map.set(Number(item.seq), item)
      })
      return Array.from(map.values()).sort((a, b) => Number(a.seq) - Number(b.seq))
    }

    function nextSince(items, fallback) {
      const base = Number.isFinite(Number(fallback)) ? Number(fallback) : 0
      if (!Array.isArray(items) || !items.length) return base
      return items.reduce((max, item) => {
        const n = Number(item && item.seq)
        return Number.isFinite(n) && n > max ? n : max
      }, base)
    }

    /** 探测时把当前草稿里的端点一起带上；宿主不认识就按已保存配置探测。 */
    function probeEndpointFromDraft(draft) {
      const source = safeObject(draft)
      const onebot = safeObject(source.onebot)
      return {
        mode: source.gateway === 'snowluma' ? 'snowluma' : 'onebot',
        wsUrl: onebot.wsUrl == null ? '' : String(onebot.wsUrl),
        httpUrl: onebot.httpUrl == null ? '' : String(onebot.httpUrl),
        wsToken: onebot.wsToken == null ? '' : String(onebot.wsToken),
        httpToken: onebot.httpToken == null ? '' : String(onebot.httpToken),
        httpAuth: onebot.httpAuth == null ? '' : String(onebot.httpAuth),
      }
    }

    /** POST /probe 返回 → 展示结构（兼容 endpointHint / url 两种字段）。 */
    function describeProbe(payload) {
      const parsed = parseApiResponse(payload)
      if (!parsed.ok) {
        return { ok: false, message: parsed.message, error: parsed.message, endpointHint: '', login: null, httpStatus: 0, elapsedMs: 0 }
      }
      const probe = isPlainObject(parsed.data.probe) ? parsed.data.probe : {}
      const login = isPlainObject(probe.login)
        ? { userId: String(probe.login.userId == null ? '' : probe.login.userId), nickname: String(probe.login.nickname == null ? '' : probe.login.nickname) }
        : null
      const failed = probe.ok === false || Boolean(probe.error)
      return {
        ok: !failed,
        message: parsed.message,
        error: failed ? String(probe.error || probe.message || '探测失败') : '',
        endpointHint: String(probe.endpointHint || probe.url || ''),
        login,
        httpStatus: Number.isFinite(Number(probe.httpStatus)) ? Number(probe.httpStatus) : 0,
        elapsedMs: Number.isFinite(Number(probe.elapsedMs)) ? Number(probe.elapsedMs) : 0,
      }
    }

    /** GET /gateway/detect 返回 → 展示结构（端点可能是脱敏后的 safeUrl）。 */
    function describeDetect(payload) {
      const parsed = parseApiResponse(payload)
      if (!parsed.ok) return { ok: false, message: parsed.message, reason: '', snowluma: null, endpoint: null }
      const data = safeObject(parsed.data)
      const snowluma = isPlainObject(data.snowluma) ? data.snowluma : null
      const endpoint = isPlainObject(data.endpoint) ? data.endpoint : null
      const endpointFound = Boolean(
        (snowluma && snowluma.endpointFound) || (endpoint && (endpoint.wsConfigured || endpoint.httpConfigured)),
      )
      return {
        ok: true,
        message: parsed.message,
        reason: data.reason == null ? '' : String(data.reason),
        snowluma: snowluma
          ? {
              installed: Boolean(snowluma.installed),
              dir: snowluma.dir == null ? '' : String(snowluma.dir),
              version: snowluma.version == null ? '' : String(snowluma.version),
              endpointFound,
              error: snowluma.error != null ? String(snowluma.error) : snowluma.reason != null ? String(snowluma.reason) : '',
            }
          : null,
        endpoint: endpoint
          ? {
              httpUrl: endpoint.httpUrl != null ? String(endpoint.httpUrl) : endpoint.httpUrlSafe != null ? String(endpoint.httpUrlSafe) : '',
              wsUrl: endpoint.wsUrl != null ? String(endpoint.wsUrl) : endpoint.wsUrlSafe != null ? String(endpoint.wsUrlSafe) : '',
              httpConfigured: Boolean(endpoint.httpConfigured),
              wsConfigured: Boolean(endpoint.wsConfigured),
              source: endpoint.source != null ? String(endpoint.source) : data.source != null ? String(data.source) : '',
            }
          : null,
      }
    }

    // =====================================================================
    // 网络（统一 /onebot-qq/api 前缀与错误形状）
    // =====================================================================

    async function request(path, options) {
      const opts = options || {}
      const init = { method: opts.method || 'GET', cache: 'no-store', headers: {} }
      if (opts.body !== undefined) {
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify(opts.body)
      }
      try {
        const response = await fetch(API + path, init)
        let payload = null
        try {
          payload = await response.json()
        } catch (error) {
          payload = null
        }
        if (!response.ok && !isPlainObject(payload)) {
          return { ok: false, message: '插件接口返回 HTTP ' + response.status }
        }
        return payload
      } catch (error) {
        const reason = error && error.message ? error.message : String(error)
        return { ok: false, message: '连不上插件：' + reason }
      }
    }

    const get = (path) => request(path)
    const post = (path, body) => request(path, { method: 'POST', body: body === undefined ? {} : body })
    const downloadMediaFile = (name) => get('/media/file/download?name=' + encodeURIComponent(name))
    const deleteMediaFile = (name) => post('/media/file/delete', { name })

    function pageHidden() {
      return typeof document !== 'undefined' && document.visibilityState === 'hidden'
    }

    // =====================================================================
    // 样式（只注入一次；apply 里用 ctx.effect 清理，SSR/测试环境自动跳过）
    // =====================================================================

    // =====================================================================
    // 外观偏好 / 语义动效（纯函数区，挂 module.exports 供 node:test 断言）
    //
    // 取值与 console-web 的 appearance preferences + Motion Foundation 对齐：
    //   accent / density / fontScale / contentWidth / motion / pageTransition
    // 所有数值都来自服务端配置；这里只做「配置值 → 令牌属性/动画语义」的确定性映射。
    // =====================================================================

    const UI_ACCENTS = ['purple', 'blue', 'green', 'orange', 'inherit']
    const UI_DENSITIES = ['compact', 'standard', 'comfortable']
    const UI_FONT_SCALES = ['small', 'standard', 'large']
    const UI_CONTENT_WIDTHS = ['standard', 'wide', 'auto']
    const UI_MOTION_MODES = ['system', 'full', 'reduced', 'off']
    const UI_PAGE_TRANSITIONS = ['default', 'fade', 'fade-slide', 'fade-up', 'fade-down', 'none']
    const UI_CONTRASTS = ['system', 'standard', 'high']

    /** 强调色令牌（与 console-web tokens.css 的 accent 预设一致；inherit 不做覆盖）。 */
    const ACCENT_TOKENS = {
      purple: {
        light: { brand: '#5d49d6', strong: '#4e3bc3', soft: '#eeebff', on: '#ffffff', ring: '#5d49d6' },
        dark: { brand: '#9b8cff', strong: '#b0a5ff', soft: '#29244d', on: '#17122d', ring: '#b0a5ff' },
      },
      blue: {
        light: { brand: '#2563eb', strong: '#1e40af', soft: '#e9f0ff', on: '#ffffff', ring: '#2563eb' },
        dark: { brand: '#8ab0ff', strong: '#a5c3ff', soft: '#1c2d52', on: '#17122d', ring: '#8ab0ff' },
      },
      green: {
        light: { brand: '#047857', strong: '#065f46', soft: '#e4f5ee', on: '#ffffff', ring: '#047857' },
        dark: { brand: '#5fd0a8', strong: '#7de0ba', soft: '#12382b', on: '#17122d', ring: '#5fd0a8' },
      },
      orange: {
        light: { brand: '#c2410c', strong: '#9a3412', soft: '#ffecdf', on: '#ffffff', ring: '#c2410c' },
        dark: { brand: '#fdab6d', strong: '#febf8f', soft: '#45230f', on: '#17122d', ring: '#fdab6d' },
      },
    }

    /** 页面转场配方 → 内容容器的 CSS 类（none 返回空串，只关转场、不关其它动效）。 */
    const TRANSITION_CLASS = {
      default: 'ob-enter-default',
      fade: 'ob-enter-fade',
      'fade-slide': 'ob-enter-slide',
      'fade-up': 'ob-enter-up',
      'fade-down': 'ob-enter-down',
      none: '',
    }

    /** 密度档位：控件高度/面板内距（rem 由 px 换算，跟随 font-scale 之外保持可读）。 */
    const DENSITY_METRICS = {
      compact: { controlSm: '1.875rem', control: '2.25rem', controlLg: '2.5rem', panelPad: '1rem', sectionGap: '1rem' },
      standard: { controlSm: '2.25rem', control: '2.75rem', controlLg: '3rem', panelPad: '1.25rem', sectionGap: '1.5rem' },
      comfortable: { controlSm: '2.625rem', control: '3.25rem', controlLg: '3.5rem', panelPad: '1.5rem', sectionGap: '1.75rem' },
    }

    const FONT_SCALE_PERCENT = { small: 93.75, standard: 100, large: 112.5 }
    const CONTENT_MAX_WIDTH = { standard: '72rem', wide: '100rem', auto: 'none' }

    const DEFAULT_UI = {
      accent: 'purple',
      density: 'standard',
      fontScale: 'standard',
      contentWidth: 'wide',
      motion: 'system',
      pageTransition: 'default',
      contrast: 'system',
    }

    /**
     * 系统设置页固定分类（只描述分组/字段路径，不携带默认值或选项）。
     * 字段标签与选项全部来自服务端 CONFIG_GROUPS.ui；未归类的新字段落到「其他界面项」。
     */
    const SETTINGS_CATEGORY_DEFS = [
      {
        id: 'appearance',
        title: '外观',
        description: 'DSH 全局主题、本面板的强调色与对比度。',
        icon: 'palette',
        theme: true,
        paths: ['ui.accent', 'ui.contrast'],
      },
      {
        id: 'layout',
        title: '布局与字号',
        description: '面板密度、字号与内容宽度。',
        icon: 'layout',
        theme: false,
        paths: ['ui.density', 'ui.fontScale', 'ui.contentWidth'],
      },
      {
        id: 'data',
        title: '数据与刷新',
        description: '面板状态轮询与列表分页。',
        icon: 'refresh',
        theme: false,
        paths: ['ui.refreshMs', 'ui.eventPageSize', 'ui.logPageSize'],
      },
      {
        id: 'motion',
        title: '动效',
        description: '动效模式与页面转场；设置分类切换始终只做淡入。',
        icon: 'sparkles',
        theme: false,
        paths: ['ui.motion', 'ui.pageTransition'],
      },
      {
        id: 'reset',
        title: '重置与说明',
        description: '恢复默认外观，查看当前生效值与作用范围。',
        icon: 'refresh',
        theme: false,
        paths: [],
      },
    ]

    /** DSH 内置主题偏好（light/dark/system）；自定义主题会显示为额外状态。 */
    const THEME_OPTIONS = [
      { value: 'light', label: '浅色', icon: 'sun' },
      { value: 'dark', label: '深色', icon: 'moon' },
      { value: 'system', label: '跟随系统', icon: 'monitor' },
    ]

    function include(value, list) {
      return list.includes(value)
    }

    function clamp01(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return 0
      return Math.max(0, Math.min(1, number))
    }

    /** ease-out cubic：动效数值插值统一使用（与 console-web 的克制动感一致）。 */
    function easeOutCubic(progress) {
      const p = clamp01(progress)
      return 1 - Math.pow(1 - p, 3)
    }

    /**
     * 解析动效模式：system 跟随 prefers-reduced-motion，full 强制开启，reduced/off 明确降级。
     * @param {string} pref 配置里的 ui.motion
     * @param {boolean} systemReduced 系统是否要求减少动效
     * @returns {'full'|'reduced'|'off'}
     */
    function resolveMotionMode(pref, systemReduced) {
      const value = include(pref, UI_MOTION_MODES) ? pref : 'system'
      if (value === 'system') return systemReduced ? 'reduced' : 'full'
      return value
    }

    function motionDisabled(mode) {
      return mode === 'reduced' || mode === 'off'
    }

    /** 动效分类（screen/async/reveal/swap/feedback/media）：reduced/off 全部关闭。 */
    function motionCategories(mode) {
      const enabled = mode === 'full'
      return { screen: enabled, async: enabled, reveal: enabled, swap: enabled, feedback: enabled, media: enabled }
    }

    function shouldAnimate(mode, category) {
      if (mode !== 'full') return false
      const categories = motionCategories(mode)
      return Boolean(categories[category === undefined ? 'screen' : category])
    }

    /** reveal 逐项延迟：40ms/项、上限 120ms（console-web --motion-delay-reveal-* 同值）。 */
    function revealDelayMs(order) {
      const index = Math.max(0, Math.floor(Number(order) || 0))
      return Math.min(120, index * 40)
    }

    /**
     * 数字滚动插值：from → to，progress 0..1，使用 ease-out cubic；非数字时直接返回 to。
     * （是否允许动画由调用方按 Motion Policy 决定，本函数只做数值插值。）
     */
    function countUpValue(from, to, progress) {
      const target = Number(to)
      if (!Number.isFinite(target)) return to
      const start = Number(from)
      if (!Number.isFinite(start)) return target
      const value = start + (target - start) * easeOutCubic(progress)
      return Math.round(value)
    }

    /**
     * Presence 状态机（feedback.enter/exit）：
     * unmounted →(visible) enter →(animationend) stable →(hidden) exit →(animationend) unmounted；
     * 快速反转（enter 中隐藏 / exit 中显示）安全回到目标方向。
     */
    function nextPresence(phase, visible) {
      switch (phase) {
        case 'unmounted':
          return visible ? 'enter' : 'unmounted'
        case 'enter':
          return visible ? 'stable' : 'exit'
        case 'stable':
          return visible ? 'stable' : 'exit'
        case 'exit':
          return visible ? 'enter' : 'unmounted'
        default:
          return visible ? 'enter' : 'unmounted'
      }
    }

    /** 页面转场配方 → className（非法值回退 default）。 */
    function pageTransitionClass(pref) {
      const value = include(pref, UI_PAGE_TRANSITIONS) ? pref : 'default'
      return TRANSITION_CLASS[value] || ''
    }

    /**
     * 顶层标签页的转场配方：配置 / 系统设置是持久化设置壳，进入时只淡入，
     * 不整页位移（用户明确要求“不要一整个页面切换滑动”）；其它页签沿用配置。
     */
    function contentTransitionFor(tab, pref) {
      const value = include(pref, UI_PAGE_TRANSITIONS) ? pref : 'default'
      if (tab === 'config' || tab === 'settings') return 'fade'
      return value
    }

    /** 对比度偏好解析：system 跟随 prefers-contrast，standard/high 显式生效。 */
    function resolveContrast(pref, systemMore) {
      const value = include(pref, UI_CONTRASTS) ? pref : 'system'
      if (value === 'system') return systemMore ? 'high' : 'standard'
      return value
    }

    /** 不可变地按 path 合并多个字段（系统设置即时保存使用）。 */
    function applyConfigPatch(base, patch) {
      let next = clone(isPlainObject(base) ? base : {})
      if (!isPlainObject(patch)) return next
      for (const path of Object.keys(patch)) next = setByPath(next, path, patch[path])
      return next
    }

    /**
     * 系统设置页分类：把服务端 ui 字段按路径分组；未知字段进入「其他界面项」。
     * 返回的每个分类字段仍带服务端 label/type/options/default，客户端不写死选项。
     */
    function settingsSections(groups) {
      const specs = systemFieldSpecs(groups)
      const uiGroup = specs.find((group) => group.id === 'ui')
      const fields = uiGroup ? uiGroup.fields : []
      const used = new Set()
      const sections = SETTINGS_CATEGORY_DEFS.map((definition) => {
        const sectionFields = definition.paths
          .map((path) => fields.find((field) => field.path === path))
          .filter(Boolean)
        for (const field of sectionFields) used.add(field.path)
        return Object.assign({}, definition, { fields: sectionFields })
      })
      const orphans = fields.filter((field) => !used.has(field.path))
      if (orphans.length) {
        const other = {
          id: 'other',
          title: '其他界面项',
          description: '服务端新增、尚未归类的界面字段。',
          icon: 'config',
          theme: false,
          paths: [],
          fields: orphans,
        }
        const resetIndex = sections.findIndex((section) => section.id === 'reset')
        if (resetIndex >= 0) sections.splice(resetIndex, 0, other)
        else sections.push(other)
      }
      return sections.filter((section) => section.id === 'appearance' || section.id === 'reset' || section.fields.length > 0)
    }

    function accentValues(accent, dark) {
      if (accent === 'inherit') return null
      const preset = ACCENT_TOKENS[accent] || ACCENT_TOKENS.purple
      return dark ? preset.dark : preset.light
    }

    function fontScalePercent(scale) {
      return FONT_SCALE_PERCENT[scale] || FONT_SCALE_PERCENT.standard
    }

    function densityMetrics(density) {
      return DENSITY_METRICS[density] || DENSITY_METRICS.standard
    }

    function contentMaxWidth(width) {
      return CONTENT_MAX_WIDTH[width] || CONTENT_MAX_WIDTH.wide
    }

    function normalizeUiPreferences(ui) {
      const source = isPlainObject(ui) ? ui : {}
      return {
        accent: include(source.accent, UI_ACCENTS) ? source.accent : DEFAULT_UI.accent,
        density: include(source.density, UI_DENSITIES) ? source.density : DEFAULT_UI.density,
        fontScale: include(source.fontScale, UI_FONT_SCALES) ? source.fontScale : DEFAULT_UI.fontScale,
        contentWidth: include(source.contentWidth, UI_CONTENT_WIDTHS) ? source.contentWidth : DEFAULT_UI.contentWidth,
        motion: include(source.motion, UI_MOTION_MODES) ? source.motion : DEFAULT_UI.motion,
        pageTransition: include(source.pageTransition, UI_PAGE_TRANSITIONS) ? source.pageTransition : DEFAULT_UI.pageTransition,
        contrast: include(source.contrast, UI_CONTRASTS) ? source.contrast : DEFAULT_UI.contrast,
      }
    }

    function prefersReducedMotion() {
      try {
        return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
      } catch (error) {
        return false
      }
    }

    function prefersMoreContrast() {
      try {
        return typeof matchMedia === 'function' && matchMedia('(prefers-contrast: more)').matches
      } catch (error) {
        return false
      }
    }

    /** 根节点 data-* 属性：client 只负责声明语义，样式全部由 TOKEN_CSS 消费。 */
    function uiRootData(ui, systemReduced, systemMoreContrast) {
      const prefs = normalizeUiPreferences(ui)
      return {
        'data-accent': prefs.accent,
        'data-density': prefs.density,
        'data-font-scale': prefs.fontScale,
        'data-content-width': prefs.contentWidth,
        'data-motion': resolveMotionMode(prefs.motion, systemReduced),
        'data-page-transition': prefs.pageTransition,
        'data-contrast': resolveContrast(prefs.contrast, systemMoreContrast),
      }
    }

    /** "2 / 200" 这类缓冲值拆成可分别滚动显示的数字；无法解析时原样返回。 */
    function splitBufferValue(value) {
      const text = String(value == null ? '' : value).trim()
      const match = /^(\d+)\s*\/\s*(\d+)$/.exec(text)
      if (!match) return null
      return { used: Number(match[1]), capacity: Number(match[2]) }
    }

    /** 千分位（不依赖 locale，保证测试与不同 DSH locale 下输出稳定）。 */
    function formatCount(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return String(value == null ? '' : value)
      const rounded = Math.round(number)
      const sign = rounded < 0 ? '-' : ''
      const digits = String(Math.abs(rounded))
      let out = ''
      for (let i = 0; i < digits.length; i += 1) {
        if (i > 0 && (digits.length - i) % 3 === 0) out += ','
        out += digits[i]
      }
      return sign + out
    }

    // =====================================================================
    // 样式层 1/3：设计令牌（TOKEN_CSS）
    //
    // 约束（由 panel.test.js 锁定）：
    //   - 全文件只有本区块允许出现十六进制色值；
    //   - 组件样式不得直接写裸 font-weight，必须使用 --ob-weight-*；
    //   - 所有外观偏好都在这里映射为 data-* 选择器，组件不感知配置细节。
    // 令牌来源：console-web packages/design-system/src/tokens.css（浅色/暗色/强调色/密度/字号）。
    // =====================================================================

    const TOKEN_CSS = `
.ob-root{
  /* ---- 颜色：浅色（console-web light palette） ---- */
  --ob-canvas:#f6f7fb;
  --ob-surface:#ffffff;
  --ob-surface-raised:#ffffff;
  --ob-surface-muted:#f0f2f7;
  --ob-surface-inset:#e9ecf3;
  --ob-border:#e4e7ee;
  --ob-border-strong:#cfd5df;
  --ob-ink:#172033;
  --ob-ink-muted:#596579;
  --ob-ink-dim:#8a95a8;
  --ob-brand:#5d49d6;
  --ob-brand-strong:#4e3bc3;
  --ob-brand-soft:#eeebff;
  --ob-on-brand:#ffffff;
  --ob-focus-ring:#5d49d6;
  --ob-success:#10703f;
  --ob-success-soft:#e8f7ef;
  --ob-warning:#b54708;
  --ob-warning-soft:#fff2df;
  --ob-danger:#c4323d;
  --ob-danger-soft:#ffeaec;
  --ob-info:#2463eb;
  --ob-info-soft:#e9f0ff;
  --ob-scrim:rgb(15 23 42 / 0.38);
  --ob-chart-1:#5d49d6;
  --ob-chart-2:#2463eb;
  --ob-chart-3:#0f7f74;
  --ob-chart-4:#b45309;
  --ob-chart-5:#be3b6b;
  --ob-skeleton:rgb(23 32 51 / 0.06);
  --ob-skeleton-strong:rgb(23 32 51 / 0.10);
  --ob-hover:rgb(23 32 51 / 0.04);
  --ob-hover-strong:rgb(23 32 51 / 0.07);
  --ob-selection:rgb(93 73 214 / 0.18);

  /* ---- 字体与排版（字重只在这里声明） ---- */
  --ob-font-ui:"Inter Variable",Inter,"Segoe UI Variable","Segoe UI",system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
  --ob-font-mono:ui-monospace,"Cascadia Code","SF Mono",Consolas,"Liberation Mono",monospace;
  --ob-weight-display:700;
  --ob-weight-heading:600;
  --ob-weight-label:600;
  --ob-weight-medium:500;
  --ob-weight-body:400;
  --ob-font-scale:1;
  --ob-text-display:calc(1.875rem * var(--ob-font-scale));
  --ob-text-title:calc(1.25rem * var(--ob-font-scale));
  --ob-text-section:calc(1rem * var(--ob-font-scale));
  --ob-text-body:calc(0.875rem * var(--ob-font-scale));
  --ob-text-small:calc(0.8125rem * var(--ob-font-scale));
  --ob-text-micro:calc(0.75rem * var(--ob-font-scale));
  --ob-leading-body:1.6;
  --ob-tracking-display:-0.02em;
  --ob-tracking-eyebrow:0.16em;

  /* ---- 圆角 / 阴影 ---- */
  --ob-radius-control:0.75rem;
  --ob-radius-panel:1rem;
  --ob-radius-shell:1.25rem;
  --ob-radius-pill:9999px;
  --ob-shadow-panel:0 1px 2px rgb(15 23 42 / 0.04),0 12px 32px rgb(15 23 42 / 0.06);
  --ob-shadow-card:0 1px 2px rgb(15 23 42 / 0.03);
  --ob-shadow-overlay:0 24px 64px rgb(15 23 42 / 0.18);
  --ob-shadow-toast:0 16px 40px rgb(15 23 42 / 0.16);

  /* ---- 间距：随密度覆盖 ---- */
  --ob-control-sm:2.25rem;
  --ob-control:2.75rem;
  --ob-control-lg:3rem;
  --ob-panel-pad:1.25rem;
  --ob-section-gap:1.5rem;
  --ob-control-gap:0.75rem;
  --ob-focus-width:0.125rem;
  --ob-focus-offset:0.125rem;

  /* ---- 动效（console-web motion tokens） ---- */
  --ob-ease:cubic-bezier(0.2,0.8,0.2,1);
  --ob-dur-fast:120ms;
  --ob-dur-standard:180ms;
  --ob-dur-slow:240ms;
  --ob-dur-control:var(--ob-dur-fast);
  --ob-dur-feedback:var(--ob-dur-standard);
  --ob-dur-page:var(--ob-dur-slow);
  --ob-dur-progress:180ms;
  --ob-dur-progress-cycle:1100ms;
  --ob-distance-enter:0.5rem;
  --ob-distance-page:1.5rem;
  --ob-opacity-reveal-start:0.96;
  --ob-content-max:100rem;
  /* 主题预览小窗的固定色（浅/深各一套，不随当前主题变化） */
  --ob-preview-light-canvas:#f6f7fb;
  --ob-preview-light-surface:#ffffff;
  --ob-preview-light-ink:#172033;
  --ob-preview-light-border:#e4e7ee;
  --ob-preview-dark-canvas:#0d111c;
  --ob-preview-dark-surface:#141a27;
  --ob-preview-dark-ink:#f5f7fb;
  --ob-preview-dark-border:#273247;
}

/* ---- 颜色：暗色（DSH 通过 body[data-ds-dark-theme] 标记暗色主题） ---- */
body[data-ds-dark-theme] .ob-root{
  --ob-canvas:#0d111c;
  --ob-surface:#141a27;
  --ob-surface-raised:#1a2232;
  --ob-surface-muted:#20293a;
  --ob-surface-inset:#101622;
  --ob-border:#273247;
  --ob-border-strong:#36435b;
  --ob-ink:#f5f7fb;
  --ob-ink-muted:#9aa6ba;
  --ob-ink-dim:#6f7c92;
  --ob-brand:#9b8cff;
  --ob-brand-strong:#b0a5ff;
  --ob-brand-soft:#29244d;
  --ob-on-brand:#17122d;
  --ob-focus-ring:#b0a5ff;
  --ob-success:#57d08b;
  --ob-success-soft:#153827;
  --ob-warning:#f3b55a;
  --ob-warning-soft:#3d2d18;
  --ob-danger:#ff7a86;
  --ob-danger-soft:#422129;
  --ob-info:#78a5ff;
  --ob-info-soft:#192d55;
  --ob-scrim:rgb(0 0 0 / 0.58);
  --ob-chart-1:#9b8cff;
  --ob-chart-2:#78a5ff;
  --ob-chart-3:#4fd1b8;
  --ob-chart-4:#f3b55a;
  --ob-chart-5:#f78fb3;
  --ob-skeleton:rgb(245 247 251 / 0.07);
  --ob-skeleton-strong:rgb(245 247 251 / 0.12);
  --ob-hover:rgb(255 255 255 / 0.05);
  --ob-hover-strong:rgb(255 255 255 / 0.09);
  --ob-selection:rgb(155 140 255 / 0.26);
  --ob-shadow-panel:0 1px 2px rgb(0 0 0 / 0.32),0 16px 40px rgb(0 0 0 / 0.28);
  --ob-shadow-card:0 1px 2px rgb(0 0 0 / 0.24);
  --ob-shadow-overlay:0 24px 64px rgb(0 0 0 / 0.56);
  --ob-shadow-toast:0 16px 40px rgb(0 0 0 / 0.46);
}

/* ---- 强调色预设：light ---- */
.ob-root[data-accent='purple']{--ob-brand:#5d49d6;--ob-brand-strong:#4e3bc3;--ob-brand-soft:#eeebff;--ob-on-brand:#ffffff;--ob-focus-ring:#5d49d6}
.ob-root[data-accent='blue']{--ob-brand:#2563eb;--ob-brand-strong:#1e40af;--ob-brand-soft:#e9f0ff;--ob-on-brand:#ffffff;--ob-focus-ring:#2563eb}
.ob-root[data-accent='green']{--ob-brand:#047857;--ob-brand-strong:#065f46;--ob-brand-soft:#e4f5ee;--ob-on-brand:#ffffff;--ob-focus-ring:#047857}
.ob-root[data-accent='orange']{--ob-brand:#c2410c;--ob-brand-strong:#9a3412;--ob-brand-soft:#ffecdf;--ob-on-brand:#ffffff;--ob-focus-ring:#c2410c}

/* ---- 强调色预设：dark ---- */
body[data-ds-dark-theme] .ob-root[data-accent='purple']{--ob-brand:#9b8cff;--ob-brand-strong:#b0a5ff;--ob-brand-soft:#29244d;--ob-on-brand:#17122d;--ob-focus-ring:#b0a5ff}
body[data-ds-dark-theme] .ob-root[data-accent='blue']{--ob-brand:#8ab0ff;--ob-brand-strong:#a5c3ff;--ob-brand-soft:#1c2d52;--ob-on-brand:#17122d;--ob-focus-ring:#8ab0ff}
body[data-ds-dark-theme] .ob-root[data-accent='green']{--ob-brand:#5fd0a8;--ob-brand-strong:#7de0ba;--ob-brand-soft:#12382b;--ob-on-brand:#17122d;--ob-focus-ring:#5fd0a8}
body[data-ds-dark-theme] .ob-root[data-accent='orange']{--ob-brand:#fdab6d;--ob-brand-strong:#febf8f;--ob-brand-soft:#45230f;--ob-on-brand:#17122d;--ob-focus-ring:#fdab6d}

/* ---- 强调色：跟随 DSH 主题（继承宿主语义 token） ---- */
.ob-root[data-accent='inherit']{
  --ob-brand:var(--dsw-alias-brand-primary);
  --ob-brand-strong:var(--dsw-alias-brand-primary);
  --ob-brand-soft:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);
  --ob-on-brand:var(--dsw-alias-bg-base);
  --ob-focus-ring:var(--dsw-alias-brand-primary);
}

/* ---- 密度 ---- */
.ob-root[data-density='compact']{
  --ob-control-sm:1.875rem;
  --ob-control:2.25rem;
  --ob-control-lg:2.5rem;
  --ob-panel-pad:1rem;
  --ob-section-gap:1rem;
  --ob-radius-control:0.625rem;
  --ob-radius-panel:0.875rem;
}
.ob-root[data-density='comfortable']{
  --ob-control-sm:2.625rem;
  --ob-control:3.25rem;
  --ob-control-lg:3.5rem;
  --ob-panel-pad:1.5rem;
  --ob-section-gap:1.75rem;
}

/* ---- 字号缩放 ---- */
.ob-root[data-font-scale='small']{--ob-font-scale:0.9375}
.ob-root[data-font-scale='large']{--ob-font-scale:1.125}

/* ---- 内容宽度 ---- */
.ob-root[data-content-width='standard']{--ob-content-max:72rem}
.ob-root[data-content-width='wide']{--ob-content-max:100rem}
.ob-root[data-content-width='auto']{--ob-content-max:none}

/* ---- 对比度（本面板级；ui.contrast=system 跟随 prefers-contrast） ---- */
.ob-root[data-contrast='high']{
  --ob-border:#bcc5d3;
  --ob-border-strong:#8c97aa;
  --ob-ink:#0b1220;
  --ob-ink-muted:#3c485c;
  --ob-ink-dim:#5a6678;
  --ob-surface-muted:#e8ecf3;
  --ob-hover:rgb(23 32 51 / 0.06);
  --ob-hover-strong:rgb(23 32 51 / 0.10);
  --ob-focus-width:0.1875rem;
}
body[data-ds-dark-theme] .ob-root[data-contrast='high']{
  --ob-border:#4a5a76;
  --ob-border-strong:#6a7c9a;
  --ob-ink:#ffffff;
  --ob-ink-muted:#c3ccda;
  --ob-ink-dim:#9aa7ba;
  --ob-surface-muted:#263248;
  --ob-focus-width:0.1875rem;
}
`

    // =====================================================================
    // 样式层 2/3：语义动效（MOTION_CSS）
    //
    // 约束（由 panel.test.js 锁定）：
    //   - 全文件只有本区块允许 @keyframes 与 animation: 声明；
    //   - 动效只使用 opacity/transform/width 等合成友好属性，不改高度与滚动容器；
    //   - reduced/off 与 prefers-reduced-motion 在这里统一降级为 0.01ms（状态仍然立即完成）。
    // 配方命名沿用 console-web Motion Foundation：
    //   content.enter / content.swap / viewport.reveal / feedback.enter+exit / progress.trickle
    // =====================================================================

    const MOTION_CSS = `
/* ---- recipe: content.enter（标签页/区块内容进入） ---- */
@keyframes ob-content-rise{
  from{opacity:0;transform:translateY(var(--ob-distance-enter))}
  to{opacity:1;transform:none}
}
@keyframes ob-content-fade{
  from{opacity:0}
  to{opacity:1}
}
@keyframes ob-content-slide{
  from{opacity:0;transform:translateX(var(--ob-distance-page))}
  to{opacity:1;transform:none}
}
@keyframes ob-content-up{
  from{opacity:0;transform:translateY(var(--ob-distance-page))}
  to{opacity:1;transform:none}
}
@keyframes ob-content-down{
  from{opacity:0;transform:translateY(calc(var(--ob-distance-page) * -1))}
  to{opacity:1;transform:none}
}

/* ---- recipe: content.swap（设置分类切换：仅淡入，无位移、不整页滑动） ---- */
@keyframes ob-swap-in{
  from{opacity:0}
  to{opacity:1}
}

/* ---- recipe: viewport.reveal（首次进入视口的区块/卡片，一次） ---- */
@keyframes ob-reveal-rise{
  from{opacity:var(--ob-opacity-reveal-start);transform:translateY(var(--ob-distance-enter))}
  to{opacity:1;transform:none}
}

/* ---- recipe: feedback.enter/exit（banner/toast/savebar 挂载与卸载） ---- */
@keyframes ob-feedback-enter{
  from{opacity:0;transform:translateY(calc(var(--ob-distance-enter) * -1))}
  to{opacity:1;transform:none}
}
@keyframes ob-feedback-exit{
  to{opacity:0;transform:translateY(calc(var(--ob-distance-enter) * -0.5))}
}

/* ---- recipe: feed（事件流新行进入） ---- */
@keyframes ob-feed-in{
  from{opacity:0;transform:translateY(-0.25rem) scale(0.995)}
  to{opacity:1;transform:none}
}

/* ---- recipe: progress.trickle（顶部不确定进度：0→85% 后保持） ---- */
@keyframes ob-progress-grow{
  0%{width:0%}
  100%{width:85%}
}
@keyframes ob-progress-fade{
  to{opacity:0}
}

/* ---- recipe: status（状态脉冲与连接呼吸） ---- */
@keyframes ob-ping{
  0%{transform:scale(1);opacity:0.55}
  70%,100%{transform:scale(2.4);opacity:0}
}
@keyframes ob-breathe{
  0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--ob-ok) 28%,transparent)}
  50%{box-shadow:0 0 0 5px color-mix(in srgb,var(--ob-ok) 0%,transparent)}
}
@keyframes ob-pulse{
  0%,100%{opacity:1}
  50%{opacity:0.45}
}
@keyframes ob-rotate{
  to{transform:rotate(360deg)}
}

/* ---- 内容进入配方类（由 pageTransition 配置选择其一） ---- */
.ob-enter-default{animation:ob-content-rise var(--ob-dur-feedback) var(--ob-ease) both}
.ob-enter-fade{animation:ob-content-fade var(--ob-dur-feedback) var(--ob-ease) both}
.ob-enter-slide{animation:ob-content-slide var(--ob-dur-page) var(--ob-ease) both}
.ob-enter-up{animation:ob-content-up var(--ob-dur-page) var(--ob-ease) both}
.ob-enter-down{animation:ob-content-down var(--ob-dur-page) var(--ob-ease) both}

/* ---- Reveal：JS 写入 data-reveal 与 --ob-reveal-delay；无 JS 时保持可见 ---- */
.ob-reveal[data-reveal='pending']{opacity:var(--ob-opacity-reveal-start)}
.ob-reveal[data-reveal='revealed']{
  animation:ob-reveal-rise var(--ob-dur-feedback) var(--ob-ease) both;
  animation-delay:var(--ob-reveal-delay,0ms);
}

/* ---- Presence：enter/stable/exit ---- */
.ob-presence[data-presence='enter']{animation:ob-feedback-enter var(--ob-dur-feedback) var(--ob-ease) both}
.ob-presence[data-presence='exit']{animation:ob-feedback-exit var(--ob-dur-fast) var(--ob-ease) both;pointer-events:none}

/* ---- 设置壳右侧内容切换（content.swap）：只淡入，壳/页头/导航不动 ---- */
.ob-swap{animation:ob-swap-in var(--ob-dur-feedback) var(--ob-ease) both}
.ob-root[data-motion='reduced'] .ob-swap,
.ob-root[data-motion='off'] .ob-swap{animation:none}

/* ---- 事件流新行进入 ---- */
.ob-feed-item{animation:ob-feed-in var(--ob-dur-feedback) var(--ob-ease) both}

/* ---- 顶部进度条 ---- */
.ob-progress-fill{width:0%}
.ob-progress[data-phase='pending'] .ob-progress-fill{
  animation:ob-progress-grow var(--ob-dur-progress-cycle) var(--ob-ease) forwards;
}
.ob-progress[data-phase='completing'] .ob-progress-fill{
  width:100%;
  animation:none;
  transition:width var(--ob-dur-progress) var(--ob-ease);
}
.ob-progress[data-phase='completing']{
  animation:ob-progress-fade var(--ob-dur-progress) var(--ob-ease) both;
  animation-delay:var(--ob-dur-progress);
}

/* ---- 状态/加载动效 ---- */
.ob-dot[data-live='true']{animation:ob-breathe 2.4s ease-in-out infinite}
.ob-dot[data-live='true']::after{content:"";animation:ob-ping 1.8s var(--ob-ease) infinite}
.ob-skeleton{animation:ob-pulse 1.6s ease-in-out infinite}
.ob-spin{animation:ob-rotate 0.9s linear infinite}

/* ---- Motion Policy：reduced / off 统一零时长降级 ---- */
.ob-root[data-motion='reduced'] *,
.ob-root[data-motion='reduced'] *::before,
.ob-root[data-motion='reduced'] *::after,
.ob-root[data-motion='off'] *,
.ob-root[data-motion='off'] *::before,
.ob-root[data-motion='off'] *::after{
  animation-duration:0.01ms!important;
  animation-delay:0ms!important;
  animation-iteration-count:1!important;
  transition-duration:0.01ms!important;
  scroll-behavior:auto!important;
}
.ob-root[data-motion='reduced'] .ob-reveal[data-reveal='pending'],
.ob-root[data-motion='off'] .ob-reveal[data-reveal='pending']{
  opacity:1;
}
.ob-root[data-motion='off'] .ob-progress{display:none}
.ob-root[data-motion='off'] .ob-dot[data-live='true']::after{display:none}

/* 系统 prefer-reduced-motion：除了显式 ui.motion=full，都降级（与 console-web 语义一致）。 */
@media (prefers-reduced-motion: reduce){
  .ob-root:not([data-motion='full']) *,
  .ob-root:not([data-motion='full']) *::before,
  .ob-root:not([data-motion='full']) *::after{
    animation-duration:0.01ms!important;
    animation-delay:0ms!important;
    animation-iteration-count:1!important;
    transition-duration:0.01ms!important;
  }
  .ob-root:not([data-motion='full']) .ob-reveal[data-reveal='pending']{opacity:1}
  .ob-root .ob-commandbar *,
  .ob-root .ob-commandbar *::before,
  .ob-root .ob-commandbar *::after{animation:none!important;transition:none!important}
}
`

    // =====================================================================
    // 样式层 3/3：布局与组件（PANEL_CSS）
    //
    // 约束（由 panel.test.js 锁定）：只消费 --ob-* / --dsw-* 变量；
    // 不出现十六进制色值、不写裸 font-weight、不声明 @keyframes（动效见 MOTION_CSS）。
    // 视觉基准：console-web 的 PageHeader / Panel / Card / StatusPill / TabsView(soft) / StateSurface。
    // =====================================================================

    const PANEL_CSS = `
.ob-root{
  height:100%;overflow:auto;overflow-x:clip;box-sizing:border-box;
  --ob-commandbar-height:calc(109px + env(safe-area-inset-top,0px));
  background:var(--ob-canvas);color:var(--ob-ink);
  font-family:var(--ob-font-ui);font-size:var(--ob-text-body);line-height:var(--ob-leading-body);
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
  padding:0 0 48px;
  color-scheme:light;
}
body[data-ds-dark-theme] .ob-root{color-scheme:dark}
.ob-root *{box-sizing:border-box}
.ob-root ::selection{background:var(--ob-selection);color:var(--ob-ink)}
.ob-root button,.ob-root input,.ob-root select,.ob-root textarea{font:inherit;color:inherit}
.ob-root a{color:var(--ob-brand);text-decoration:none}
.ob-root a:hover{text-decoration:underline}
.ob-root :focus-visible{outline:var(--ob-focus-width) solid var(--ob-focus-ring);outline-offset:var(--ob-focus-offset);border-radius:var(--ob-radius-control)}
.ob-shell{display:block;width:100%;min-width:0;max-width:none;margin:0;padding:0 20px}
:root[data-platform='darwin'] .ob-root{padding-top:var(--dsh-frame-top-clearance,0px)}
.ob-page{display:flex;flex-direction:column;gap:12px;padding-top:12px}
.ob-content .ob-page{padding-top:12px;gap:16px}
.ob-content{gap:0}

/* ---------- 紧凑页头（eyebrow + 标题 + 单行描述） ---------- */
.ob-header{display:block;min-width:0;margin:0}
.ob-header-main{min-width:0;max-width:100%}
.ob-eyebrow{display:inline-flex;align-items:center;gap:8px;margin:0 0 4px;font-size:var(--ob-text-micro);line-height:1;letter-spacing:var(--ob-tracking-eyebrow);text-transform:uppercase;font-weight:var(--ob-weight-heading);color:var(--ob-brand)}
.ob-eyebrow-dot{width:6px;height:6px;border-radius:var(--ob-radius-pill);background:var(--ob-brand)}
.ob-display{margin:0;font-size:var(--ob-text-title);line-height:1.2;letter-spacing:var(--ob-tracking-display);font-weight:var(--ob-weight-display);color:var(--ob-ink);overflow-wrap:anywhere;text-wrap:balance}
.ob-subtitle{margin:4px 0 0;max-width:100%;font-size:var(--ob-text-small);line-height:1.5;color:var(--ob-ink-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ob-brand-mark{display:flex;align-items:center;justify-content:center;flex:none;width:40px;height:40px;border-radius:var(--ob-radius-control);background:var(--ob-brand);color:var(--ob-on-brand);box-shadow:var(--ob-shadow-card)}
.ob-brand-mark svg{width:22px;height:22px}
.ob-hint-inline{display:inline-flex;align-items:center;gap:6px;font-size:var(--ob-text-micro);color:var(--ob-ink-muted)}
.ob-hint-inline .ob-spin{width:12px;height:12px}

/* ---------- 状态 pill / 徽标 ---------- */
.ob-status-pill{display:inline-flex;align-items:center;gap:8px;max-width:100%;height:30px;padding:0 12px;border-radius:var(--ob-radius-pill);background:var(--ob-surface-muted);color:var(--ob-ink-muted);font-size:var(--ob-text-micro);font-weight:var(--ob-weight-heading);white-space:nowrap}
.ob-status-pill.ok{background:var(--ob-success-soft);color:var(--ob-success)}
.ob-status-pill.warn{background:var(--ob-warning-soft);color:var(--ob-warning)}
.ob-status-pill.err{background:var(--ob-danger-soft);color:var(--ob-danger)}
.ob-status-pill.info{background:var(--ob-info-soft);color:var(--ob-info)}
.ob-status-extra{max-width:180px;overflow:hidden;text-overflow:ellipsis;color:color-mix(in srgb,currentColor 72%,transparent);font-weight:var(--ob-weight-medium)}
.ob-dot{position:relative;flex:none;display:inline-block;width:7px;height:7px;border-radius:var(--ob-radius-pill);background:currentColor}
.ob-dot::after{content:"";position:absolute;inset:0;border-radius:inherit;background:currentColor;opacity:0}
.ob-badge{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 9px;border-radius:var(--ob-radius-pill);background:var(--ob-surface-muted);color:var(--ob-ink-muted);font-size:var(--ob-text-micro);font-weight:var(--ob-weight-heading);white-space:nowrap}
.ob-badge.ok{background:var(--ob-success-soft);color:var(--ob-success)}
.ob-badge.warn{background:var(--ob-warning-soft);color:var(--ob-warning)}
.ob-badge.err{background:var(--ob-danger-soft);color:var(--ob-danger)}
.ob-badge.info{background:var(--ob-info-soft);color:var(--ob-info)}
.ob-badge.brand{background:var(--ob-brand-soft);color:var(--ob-brand)}

/* ---------- 按钮 ---------- */
.ob-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-width:0;height:var(--ob-control);padding:0 16px;border:1px solid var(--ob-border);border-radius:var(--ob-radius-control);background:var(--ob-surface);color:var(--ob-ink);font-size:var(--ob-text-body);font-weight:var(--ob-weight-medium);line-height:1;white-space:nowrap;cursor:pointer;box-shadow:var(--ob-shadow-card);transition:background-color var(--ob-dur-control) var(--ob-ease),border-color var(--ob-dur-control) var(--ob-ease),transform var(--ob-dur-control) var(--ob-ease),box-shadow var(--ob-dur-control) var(--ob-ease),color var(--ob-dur-control) var(--ob-ease)}
.ob-btn svg{width:16px;height:16px;flex:none}
.ob-btn:hover{border-color:var(--ob-border-strong);background:var(--ob-hover)}
.ob-btn:active{transform:scale(0.98)}
.ob-btn[disabled],.ob-btn[aria-disabled='true']{opacity:0.5;cursor:not-allowed;transform:none}
.ob-btn.small{height:var(--ob-control-sm);padding:0 12px;font-size:var(--ob-text-small);border-radius:calc(var(--ob-radius-control) - 2px)}
.ob-btn.large{height:var(--ob-control-lg);padding:0 20px}
.ob-btn.primary{border-color:transparent;background:var(--ob-brand);color:var(--ob-on-brand);font-weight:var(--ob-weight-heading);box-shadow:var(--ob-shadow-card)}
.ob-btn.primary:hover{background:var(--ob-brand-strong);border-color:transparent}
.ob-btn.secondary{border-color:var(--ob-brand);background:var(--ob-brand-soft);color:var(--ob-brand)}
.ob-btn.secondary:hover{background:color-mix(in srgb,var(--ob-brand-soft) 78%,var(--ob-brand) 8%);border-color:var(--ob-brand-strong)}
.ob-btn.ghost{border-color:transparent;background:transparent;box-shadow:none;color:var(--ob-ink-muted)}
.ob-btn.ghost:hover{background:var(--ob-hover-strong);color:var(--ob-ink)}
.ob-btn.danger{border-color:var(--ob-danger-soft);background:var(--ob-danger-soft);color:var(--ob-danger)}
.ob-btn.danger:hover{border-color:var(--ob-danger);background:color-mix(in srgb,var(--ob-danger-soft) 74%,var(--ob-danger) 10%)}
.ob-btn.block{width:100%}
.ob-icon-btn{display:inline-flex;align-items:center;justify-content:center;flex:none;width:var(--ob-control);height:var(--ob-control);padding:0;border:1px solid var(--ob-border);border-radius:var(--ob-radius-control);background:var(--ob-surface);color:var(--ob-ink-muted);cursor:pointer;box-shadow:var(--ob-shadow-card);transition:background-color var(--ob-dur-control) var(--ob-ease),border-color var(--ob-dur-control) var(--ob-ease),color var(--ob-dur-control) var(--ob-ease),transform var(--ob-dur-control) var(--ob-ease)}
.ob-icon-btn:hover{background:var(--ob-hover);color:var(--ob-ink);border-color:var(--ob-border-strong)}
.ob-icon-btn:active{transform:scale(0.96)}
.ob-icon-btn svg{width:18px;height:18px}
.ob-icon-btn.small{width:var(--ob-control-sm);height:var(--ob-control-sm)}
.ob-spinner{display:inline-block;width:14px;height:14px;border:2px solid color-mix(in srgb,currentColor 26%,transparent);border-top-color:currentColor;border-radius:var(--ob-radius-pill)}
.ob-chips{display:flex;flex-wrap:wrap;align-items:center;gap:8px}

/* ---------- 标签栏（soft TabsView + 滑块指示器） ---------- */
.ob-tabs{position:sticky;top:0;z-index:6;margin:0;padding:8px 0 6px;background:color-mix(in srgb,var(--ob-canvas) 84%,transparent);border-bottom:1px solid var(--ob-border);backdrop-filter:blur(14px) saturate(1.2);-webkit-backdrop-filter:blur(14px) saturate(1.2)}
@supports not ((backdrop-filter:blur(2px)) or (-webkit-backdrop-filter:blur(2px))){.ob-tabs{background:var(--ob-canvas)}}
:root[data-platform='darwin'] .ob-tabs{top:0}
.ob-tablist{position:relative;display:flex;align-items:center;gap:2px;width:100%;padding:4px;border-radius:var(--ob-radius-panel);background:var(--ob-surface-muted);overflow-x:auto;scrollbar-width:none;max-width:100%}
.ob-tablist::-webkit-scrollbar{display:none}
.ob-tab-pill{position:absolute;top:4px;bottom:4px;left:0;border-radius:var(--ob-radius-control);background:var(--ob-surface);box-shadow:var(--ob-shadow-card);transition:transform var(--ob-dur-standard) var(--ob-ease),width var(--ob-dur-standard) var(--ob-ease);pointer-events:none}
.ob-tab{position:relative;z-index:1;flex:none;display:inline-flex;align-items:center;gap:7px;height:var(--ob-control-sm);padding:0 14px;border:0;border-radius:var(--ob-radius-control);background:transparent;color:var(--ob-ink-muted);font-size:var(--ob-text-body);font-weight:var(--ob-weight-medium);white-space:nowrap;cursor:pointer;transition:color var(--ob-dur-control) var(--ob-ease)}
.ob-tab:hover{color:var(--ob-ink)}
.ob-tab.on{color:var(--ob-ink);font-weight:var(--ob-weight-heading)}
.ob-tab svg{width:15px;height:15px;flex:none;opacity:0.85}
.ob-tab[aria-selected='true'] svg{color:var(--ob-brand);opacity:1}
.ob-tab-dirty{width:6px;height:6px;border-radius:var(--ob-radius-pill);background:var(--ob-warning)}
.ob-content{min-width:0;overflow-x:clip}

/* ---------- 卡片 / 面板 / 章节 ---------- */
.ob-grid{display:grid;gap:var(--ob-control-gap);grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))}
.ob-grid.two{grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))}
.ob-stack{display:flex;flex-direction:column;gap:var(--ob-control-gap);min-width:0}
.ob-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.ob-spread{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px}
.ob-panel{position:relative;min-width:0;border:1px solid var(--ob-border);border-radius:var(--ob-radius-panel);background:var(--ob-surface);color:var(--ob-ink);box-shadow:var(--ob-shadow-panel);overflow:hidden}
.ob-panel.outlined{box-shadow:none}
.ob-panel.muted{border-color:transparent;background:var(--ob-surface-muted);box-shadow:none}
.ob-panel.brand{border-color:color-mix(in srgb,var(--ob-brand) 18%,transparent);background:linear-gradient(140deg,var(--ob-brand-soft),var(--ob-surface) 72%);box-shadow:var(--ob-shadow-card)}
.ob-panel-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:8px 16px;padding:var(--ob-panel-pad) var(--ob-panel-pad) calc(var(--ob-panel-pad) - 4px)}
.ob-panel-head.with-line{border-bottom:1px solid var(--ob-border)}
.ob-panel-title{margin:0;font-size:var(--ob-text-section);line-height:1.4;font-weight:var(--ob-weight-heading);color:var(--ob-ink);overflow-wrap:anywhere}
.ob-panel-desc{margin:4px 0 0;font-size:var(--ob-text-small);line-height:1.6;color:var(--ob-ink-muted);overflow-wrap:anywhere}
.ob-panel-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;flex:none}
.ob-panel-body{padding:calc(var(--ob-panel-pad) - 4px) var(--ob-panel-pad) var(--ob-panel-pad);min-width:0}
.ob-panel-body.flush{padding:0}
.ob-panel-body.inset{padding:calc(var(--ob-panel-pad) - 8px)}
.ob-panel-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:10px;padding:calc(var(--ob-panel-pad) - 6px) var(--ob-panel-pad);border-top:1px solid var(--ob-border);background:color-mix(in srgb,var(--ob-surface) 86%,var(--ob-surface-muted))}
.ob-section{display:flex;flex-direction:column;gap:10px;min-width:0}
.ob-section-title{margin:0;font-size:var(--ob-text-section);font-weight:var(--ob-weight-heading);color:var(--ob-ink)}
.ob-note{margin:0;padding:10px 12px;border-radius:var(--ob-radius-control);background:var(--ob-surface-muted);color:var(--ob-ink-muted);font-size:var(--ob-text-small);line-height:1.65}
.ob-muted{color:var(--ob-ink-muted)}
.ob-small{font-size:var(--ob-text-small)}
.ob-micro{font-size:var(--ob-text-micro)}
.ob-mono{font-family:var(--ob-font-mono)}
.ob-truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.ob-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.ob-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border:1px solid var(--ob-border);border-radius:5px;background:var(--ob-surface);font-size:var(--ob-text-micro);font-family:var(--ob-font-mono);color:var(--ob-ink-muted)}
.ob-issue-list{margin:6px 0 0;padding-left:18px;font-size:var(--ob-text-small);line-height:1.6;color:var(--ob-warning)}

/* ---------- 模块目录 / 详情（仅模块作用域） ---------- */
.ob-module-list{container:ob-module-list / inline-size;min-inline-size:0;max-inline-size:100%}
.ob-module-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--ob-control-gap);align-items:stretch;min-inline-size:0;max-inline-size:100%}
@media (width > 900px){
  @container ob-module-list (min-width:760px){
    .ob-module-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  }
}
.ob-module-card{min-inline-size:0;max-inline-size:100%;display:flex;flex-direction:column}
.ob-module-card > .ob-panel{flex:1;display:flex;flex-direction:column;min-inline-size:0;max-inline-size:100%}
.ob-module-card > .ob-panel > .ob-panel-body{flex:1}
.ob-module-card > .ob-panel > .ob-panel-foot{margin-block-start:auto}
.ob-module-scope,.ob-module-scope *{min-inline-size:0;max-inline-size:100%}
.ob-module-scope{overflow-wrap:anywhere}
.ob-module-scope .ob-panel{overflow:visible}
.ob-module-scope .ob-badge{height:auto;min-height:22px;white-space:normal;overflow-wrap:anywhere}
.ob-module-scope .ob-btn{height:auto;min-height:44px;min-width:44px;white-space:normal;overflow-wrap:anywhere}
.ob-module-toolbar,.ob-module-actions{display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px}
.ob-module-savebar,.ob-owner-savebar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.ob-module-card .ob-module-actions{display:flex;flex:1;flex-wrap:wrap;align-items:stretch;gap:8px}
.ob-module-card .ob-module-actions > .ob-btn{flex:1 1 5rem;min-height:44px}
.ob-module-card .ob-panel-desc{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ob-module-card .ob-panel-head{flex-wrap:nowrap;align-items:flex-start}
.ob-module-status{display:inline-flex;align-items:center;padding:8px;color:var(--ob-ink-muted)}
.ob-module-status.ok{color:var(--ob-success)}
.ob-module-status.err{color:var(--ob-danger)}
.ob-module-permissions{display:flex;flex-wrap:wrap;gap:6px;margin-block-start:12px}
.ob-module-action{display:flex;flex:0 1 16rem;flex-direction:column;align-items:flex-start;gap:6px}
.ob-module-action-reason{margin:0;overflow-wrap:anywhere}
.ob-module-metadata{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;margin:0;min-inline-size:0;max-inline-size:100%}
.ob-module-metadata-row{display:grid;grid-template-columns:minmax(0,12rem) minmax(0,1fr);gap:8px 16px;align-items:baseline}
.ob-module-code{display:inline-block;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;cursor:text}
.ob-module-technical{margin-block-start:12px;border-block-start:1px solid var(--ob-border);padding-block-start:8px}
.ob-module-technical > summary{padding-block:8px;min-height:44px;cursor:pointer;font-weight:var(--ob-weight-heading)}
.ob-module-technical[open] > summary{margin-block-end:8px}
.ob-module-detail-page.ob-page{padding-top:4px;gap:4px}
.ob-module-detail-page > .ob-progress[data-phase=idle]{display:none}
.ob-module-detail{gap:8px}
.ob-module-detail-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px}
.ob-module-breadcrumb{display:flex;align-items:center;gap:6px;min-width:0;font-size:var(--ob-text-small);color:var(--ob-ink-muted)}
.ob-module-back{display:inline-flex;align-items:center;min-height:44px;flex:none}
.ob-module-back[aria-disabled=true]{opacity:.5;pointer-events:none}
.ob-module-breadcrumb-current{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ob-module-detail-toolbar .ob-btn{flex:none;width:44px;height:44px;padding:0}
.ob-module-detail-header{display:flex;flex-direction:column;gap:6px}
.ob-module-consequences{font-size:var(--ob-text-small);line-height:1.4;color:var(--ob-ink-muted)}
.ob-module-detail-header h1,.ob-module-detail-header p{margin:0}
.ob-module-detail-header h1{font-size:var(--ob-text-title);line-height:1.3}
.ob-module-detail-header .ob-module-id{color:var(--ob-ink-muted);font-size:var(--ob-text-small)}
.ob-module-primary-actions{display:flex;flex-wrap:wrap;align-items:stretch;gap:8px}
.ob-module-primary-actions > .ob-btn{flex:0 1 auto;height:44px;min-height:44px;padding:0 16px}
.ob-module-primary-actions > .ob-btn.danger{background:transparent;border-color:var(--ob-danger);box-shadow:none}
.ob-module-action-group{display:flex;flex-direction:column;gap:8px}
.ob-module-action-group h3,.ob-module-action-group p{margin:0}
.ob-module-action-group .ob-module-actions{align-items:stretch}
.ob-module-health-headline{margin:0;font-size:var(--ob-text-title)}
.ob-module-metadata dt,.ob-module-metadata dd{margin:0;min-inline-size:0;max-inline-size:100%;overflow-wrap:anywhere}
.ob-module-metadata dt{color:var(--ob-ink-muted)}
.ob-module-preview{display:flex;flex-direction:column;gap:8px;margin:0;min-inline-size:0;max-inline-size:100%;overflow-wrap:anywhere}
.ob-module-preview p{margin:0}
.ob-module-scope iframe{display:block;width:100%;min-width:0;max-width:100%}
.ob-number-control{display:flex;flex-wrap:wrap;align-items:center;gap:8px;width:100%;min-width:0;max-width:100%}
.ob-number-control .ob-input{flex:1 1 8rem;min-width:0;width:auto}
.ob-number-control .ob-field-unit{flex:0 1 auto;min-width:0;max-width:100%;white-space:normal;overflow-wrap:anywhere}
@media (max-width:900px){
  .ob-module-grid{grid-template-columns:minmax(0,1fr)}
  .ob-module-metadata-row{grid-template-columns:minmax(0,7rem) minmax(0,1fr);gap:8px}
  .ob-module-detail-header{gap:4px}
  .ob-module-primary-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
  .ob-module-card .ob-module-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%}
  .ob-module-card .ob-module-actions > .ob-btn{width:100%}
  .ob-module-action{flex:1 1 10rem;align-items:flex-start}
  .ob-module-toolbar .ob-btn,.ob-module-actions .ob-btn{min-height:44px}
  .ob-number-control{flex-direction:column;align-items:stretch}
  .ob-number-control .ob-input{flex:1 1 auto;width:100%;min-height:44px}
}

/* ---------- 顶部进度条 ---------- */
.ob-progress{position:relative;height:3px;border-radius:var(--ob-radius-pill);background:transparent;overflow:hidden;margin:0}
.ob-progress-fill{position:absolute;inset-block:0;left:0;border-radius:var(--ob-radius-pill);background:var(--ob-brand);box-shadow:0 0 8px color-mix(in srgb,var(--ob-brand) 50%,transparent)}
.ob-progress-track{position:absolute;inset:0;background:var(--ob-surface-muted)}

/* ---------- 概览：hero / 统计 / 分布 / 事件流 ---------- */
.ob-hero{display:flex;flex-direction:column;gap:var(--ob-panel-pad)}
.ob-hero-main{display:flex;flex-wrap:wrap;align-items:center;gap:16px 20px;min-width:0}
.ob-hero-copy{flex:1 1 280px;min-width:0}
.ob-hero-title{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:0;font-size:var(--ob-text-title);line-height:1.3;font-weight:var(--ob-weight-display);letter-spacing:var(--ob-tracking-display);color:var(--ob-ink)}
.ob-hero-sub{margin:8px 0 0;font-size:var(--ob-text-body);line-height:1.65;color:var(--ob-ink-muted);overflow-wrap:anywhere}
.ob-hero-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.ob-hero-facts{display:grid;gap:10px 20px;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));padding-top:var(--ob-panel-pad);border-top:1px solid var(--ob-border)}
.ob-fact-k{margin:0 0 3px;font-size:var(--ob-text-micro);color:var(--ob-ink-muted);letter-spacing:0.02em}
.ob-fact-v{margin:0;font-size:var(--ob-text-small);font-weight:var(--ob-weight-label);color:var(--ob-ink);overflow-wrap:anywhere}
.ob-ring{position:relative;display:flex;align-items:center;justify-content:center;flex:none;width:56px;height:56px;border-radius:var(--ob-radius-pill);background:var(--ob-success-soft);color:var(--ob-success)}
.ob-ring.brand{background:var(--ob-brand-soft);color:var(--ob-brand)}
.ob-ring.warn{background:var(--ob-warning-soft);color:var(--ob-warning)}
.ob-ring.err{background:var(--ob-danger-soft);color:var(--ob-danger)}
.ob-ring.muted{background:var(--ob-surface-muted);color:var(--ob-ink-muted)}
.ob-ring svg{width:26px;height:26px}
.ob-stat-grid{display:grid;gap:var(--ob-control-gap);grid-template-columns:repeat(auto-fit,minmax(min(100%,168px),1fr))}
.ob-stat{display:flex;flex-direction:column;gap:8px;min-width:0;padding:calc(var(--ob-panel-pad) - 2px);border:1px solid var(--ob-border);border-radius:var(--ob-radius-panel);background:var(--ob-surface);box-shadow:var(--ob-shadow-card);transition:transform var(--ob-dur-standard) var(--ob-ease),box-shadow var(--ob-dur-standard) var(--ob-ease),border-color var(--ob-dur-standard) var(--ob-ease)}
.ob-stat:hover{transform:translateY(-1px);box-shadow:var(--ob-shadow-panel);border-color:var(--ob-border-strong)}
.ob-stat-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ob-stat-label{margin:0;font-size:var(--ob-text-micro);font-weight:var(--ob-weight-medium);color:var(--ob-ink-muted);letter-spacing:0.01em}
.ob-stat-value{margin:0;font-size:calc(1.75rem * var(--ob-font-scale));line-height:1.1;font-weight:var(--ob-weight-display);color:var(--ob-ink);font-variant-numeric:tabular-nums;letter-spacing:var(--ob-tracking-display)}
.ob-stat-hint{margin:0;font-size:var(--ob-text-micro);color:var(--ob-ink-muted);min-height:1em}
.ob-stat-bar{height:4px;border-radius:var(--ob-radius-pill);background:var(--ob-surface-muted);overflow:hidden}
.ob-stat-bar-fill{height:100%;border-radius:inherit;background:var(--ob-brand);transition:width var(--ob-dur-page) var(--ob-ease)}
.ob-icon-tile{display:inline-flex;align-items:center;justify-content:center;flex:none;width:34px;height:34px;border-radius:var(--ob-radius-control);background:var(--ob-surface-muted);color:var(--ob-ink-muted)}
.ob-icon-tile.small{width:28px;height:28px;border-radius:calc(var(--ob-radius-control) - 3px)}
.ob-icon-tile.large{width:44px;height:44px}
.ob-icon-tile svg{width:17px;height:17px}
.ob-icon-tile.small svg{width:15px;height:15px}
.ob-icon-tile.large svg{width:21px;height:21px}
.ob-icon-tile.brand{background:var(--ob-brand-soft);color:var(--ob-brand)}
.ob-icon-tile.ok{background:var(--ob-success-soft);color:var(--ob-success)}
.ob-icon-tile.warn{background:var(--ob-warning-soft);color:var(--ob-warning)}
.ob-icon-tile.err{background:var(--ob-danger-soft);color:var(--ob-danger)}
.ob-icon-tile.info{background:var(--ob-info-soft);color:var(--ob-info)}
.ob-bars{display:flex;flex-direction:column;gap:10px;min-width:0}
.ob-bar-row{display:grid;grid-template-columns:minmax(64px,110px) minmax(0,1fr) auto;align-items:center;gap:10px;min-width:0}
.ob-bar-label{font-size:var(--ob-text-small);color:var(--ob-ink-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ob-bar-track{height:6px;border-radius:var(--ob-radius-pill);background:var(--ob-surface-muted);overflow:hidden}
.ob-bar-fill{height:100%;border-radius:inherit;background:var(--ob-brand);transition:width var(--ob-dur-page) var(--ob-ease)}
.ob-bar-value{font-size:var(--ob-text-small);font-weight:var(--ob-weight-label);color:var(--ob-ink);font-variant-numeric:tabular-nums;min-width:2ch;text-align:right}
.ob-feed{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;min-width:0}
.ob-feed-item{display:flex;align-items:flex-start;gap:10px;min-width:0;padding:10px 8px;border-radius:var(--ob-radius-control);transition:background-color var(--ob-dur-control) var(--ob-ease)}
.ob-feed-item:hover{background:var(--ob-hover)}
.ob-feed-body{flex:1 1 auto;min-width:0}
.ob-feed-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;min-width:0}
.ob-feed-meta{font-size:var(--ob-text-micro);color:var(--ob-ink-muted)}
.ob-feed-text{margin:3px 0 0;font-size:var(--ob-text-body);line-height:1.55;color:var(--ob-ink);overflow-wrap:anywhere}
.ob-feed-time{flex:none;font-size:var(--ob-text-micro);color:var(--ob-ink-muted);font-variant-numeric:tabular-nums}

/* ---------- 连接页：stepper / 端点 / 检测结果 ---------- */
.ob-stepper{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:0;margin:0;list-style:none}
.ob-step{display:inline-flex;align-items:center;gap:8px;flex:none;min-width:0;white-space:nowrap;font-size:var(--ob-text-small);color:var(--ob-ink-muted)}
.ob-step-index{display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;border-radius:var(--ob-radius-pill);background:var(--ob-surface-muted);color:var(--ob-ink-muted);font-size:var(--ob-text-micro);font-weight:var(--ob-weight-heading);transition:background-color var(--ob-dur-standard) var(--ob-ease),color var(--ob-dur-standard) var(--ob-ease),transform var(--ob-dur-standard) var(--ob-ease)}
.ob-step.done .ob-step-index{background:var(--ob-success-soft);color:var(--ob-success)}
.ob-step.on{color:var(--ob-ink);font-weight:var(--ob-weight-label)}
.ob-step.on .ob-step-index{background:var(--ob-brand);color:var(--ob-on-brand);transform:scale(1.04)}
.ob-stepper-line{flex:1 1 24px;min-width:16px;height:2px;border-radius:var(--ob-radius-pill);background:var(--ob-border);margin:0;list-style:none}
.ob-stepper-line.done{background:var(--ob-success)}
.ob-endpoint-url{display:flex;align-items:center;gap:8px;min-width:0;padding:8px 10px;border-radius:var(--ob-radius-control);background:var(--ob-surface-muted);font-family:var(--ob-font-mono);font-size:var(--ob-text-small);color:var(--ob-ink-muted)}
.ob-endpoint-url .ob-truncate{flex:1 1 auto;font-family:inherit}
.ob-probe-result{display:flex;flex-wrap:wrap;align-items:flex-start;gap:10px 14px;padding:12px;border-radius:var(--ob-radius-control);background:var(--ob-surface-muted)}
.ob-probe-result.ok{background:var(--ob-success-soft);color:var(--ob-success)}
.ob-probe-result.err{background:var(--ob-danger-soft);color:var(--ob-danger)}
.ob-probe-result .ob-probe-copy{flex:1 1 220px;min-width:0}
.ob-probe-title{margin:0;font-size:var(--ob-text-small);font-weight:var(--ob-weight-label);color:currentColor}
.ob-probe-desc{margin:3px 0 0;font-size:var(--ob-text-micro);line-height:1.55;color:color-mix(in srgb,currentColor 78%,var(--ob-ink-muted))}

/* ---------- 消息页：列表 / 编辑器 / 事件流 ---------- */
.ob-split{display:grid;gap:var(--ob-section-gap);grid-template-columns:minmax(0,320px) minmax(0,1fr);align-items:start}
.ob-split.single{grid-template-columns:minmax(0,1fr)}
.ob-list{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;min-width:0;max-height:340px;overflow:auto}
.ob-list-item{display:flex;align-items:center;gap:10px;width:100%;min-width:0;padding:8px 10px;border:1px solid transparent;border-radius:var(--ob-radius-control);background:transparent;text-align:left;cursor:pointer;transition:background-color var(--ob-dur-control) var(--ob-ease),border-color var(--ob-dur-control) var(--ob-ease),transform var(--ob-dur-control) var(--ob-ease)}
.ob-list-item:hover{background:var(--ob-hover)}
.ob-list-item.on{border-color:color-mix(in srgb,var(--ob-brand) 20%,transparent);background:var(--ob-brand-soft);color:var(--ob-brand)}
.ob-list-item:active{transform:scale(0.995)}
.ob-list-avatar{display:flex;align-items:center;justify-content:center;flex:none;width:30px;height:30px;border-radius:var(--ob-radius-control);background:var(--ob-surface-muted);color:var(--ob-ink-muted);font-size:var(--ob-text-micro);font-weight:var(--ob-weight-heading);text-transform:uppercase}
.ob-list-item.on .ob-list-avatar{background:color-mix(in srgb,var(--ob-brand) 14%,transparent);color:var(--ob-brand)}
.ob-list-body{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1 1 auto}
.ob-list-title{font-size:var(--ob-text-small);font-weight:var(--ob-weight-medium);color:var(--ob-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ob-list-sub{font-size:var(--ob-text-micro);color:var(--ob-ink-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ob-seg{display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:var(--ob-radius-control);background:var(--ob-surface-muted)}
.ob-seg-btn{height:calc(var(--ob-control-sm) - 6px);padding:0 12px;border:0;border-radius:calc(var(--ob-radius-control) - 3px);background:transparent;color:var(--ob-ink-muted);font-size:var(--ob-text-small);font-weight:var(--ob-weight-medium);cursor:pointer;transition:background-color var(--ob-dur-control) var(--ob-ease),color var(--ob-dur-control) var(--ob-ease),box-shadow var(--ob-dur-control) var(--ob-ease)}
.ob-seg-btn.on{background:var(--ob-surface);color:var(--ob-ink);font-weight:var(--ob-weight-label);box-shadow:var(--ob-shadow-card)}
.ob-search{display:flex;align-items:center;gap:6px;height:var(--ob-control-sm);padding:0 10px;border:1px solid var(--ob-border);border-radius:var(--ob-radius-control);background:var(--ob-surface);color:var(--ob-ink-muted)}
.ob-search input{width:100%;min-width:0;border:0;background:transparent;outline:none;font-size:var(--ob-text-small);color:var(--ob-ink)}
.ob-search svg{width:14px;height:14px;flex:none}
.ob-composer{display:flex;flex-direction:column;gap:10px;min-width:0}
.ob-composer-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.ob-composer .ob-field + .ob-field{border-top:0}
.ob-send-result{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:8px 10px;border-radius:var(--ob-radius-control);background:var(--ob-surface-muted);font-size:var(--ob-text-small);color:var(--ob-ink-muted)}
.ob-send-result.ok{background:var(--ob-success-soft);color:var(--ob-success)}
.ob-send-result.err{background:var(--ob-danger-soft);color:var(--ob-danger)}

/* ---------- 配置页：左侧分组导航 ---------- */
.ob-settings{display:grid;gap:var(--ob-section-gap);grid-template-columns:minmax(0,196px) minmax(0,1fr);align-items:start}
.ob-settings-nav{position:sticky;top:76px;display:flex;flex-direction:column;gap:2px;min-width:0}
.ob-settings-nav-btn{display:flex;align-items:center;gap:8px;height:var(--ob-control-sm);padding:0 12px;border:0;border-radius:var(--ob-radius-control);background:transparent;color:var(--ob-ink-muted);font-size:var(--ob-text-small);font-weight:var(--ob-weight-medium);text-align:left;cursor:pointer;transition:background-color var(--ob-dur-control) var(--ob-ease),color var(--ob-dur-control) var(--ob-ease)}
.ob-settings-nav-btn:hover{background:var(--ob-hover);color:var(--ob-ink)}
.ob-settings-nav-btn.on{background:var(--ob-brand-soft);color:var(--ob-brand);font-weight:var(--ob-weight-label)}
.ob-settings-content{display:flex;flex-direction:column;gap:var(--ob-control-gap);min-width:0;scroll-margin-top:calc(var(--ob-commandbar-height) + 12px)}
.ob-settings-section{scroll-margin-top:calc(var(--ob-commandbar-height) + 12px)}
.ob-settings-pane{display:flex;flex-direction:column;gap:var(--ob-control-gap);min-width:0}
.ob-settings-nav-title{margin:10px 0 2px;padding:0 12px;font-size:var(--ob-text-micro);font-weight:var(--ob-weight-heading);letter-spacing:0.08em;text-transform:uppercase;color:var(--ob-ink-muted)}
.ob-settings-status{display:inline-flex;align-items:center;gap:6px;font-size:var(--ob-text-micro);color:var(--ob-ink-muted)}
.ob-settings-status .ob-dot{width:6px;height:6px}
.ob-settings-status.ok{color:var(--ob-success)}
.ob-settings-status.err{color:var(--ob-danger)}
.ob-settings-heading{margin:0;font-size:var(--ob-text-section);font-weight:var(--ob-weight-heading);color:var(--ob-ink)}
.ob-settings-description{margin:4px 0 0;font-size:var(--ob-text-small);line-height:1.65;color:var(--ob-ink-muted)}
.ob-option-grid{display:grid;width:100%;gap:10px;grid-template-columns:repeat(auto-fit,minmax(min(100%,168px),1fr))}
.ob-option-card{display:flex;flex-direction:column;gap:8px;min-width:0;padding:12px;border:1px solid var(--ob-border);border-radius:var(--ob-radius-control);background:var(--ob-surface);color:var(--ob-ink);text-align:start;cursor:pointer;transition:border-color var(--ob-dur-control) var(--ob-ease),background-color var(--ob-dur-control) var(--ob-ease),box-shadow var(--ob-dur-control) var(--ob-ease),transform var(--ob-dur-control) var(--ob-ease)}
.ob-option-card:hover{border-color:var(--ob-border-strong);background:var(--ob-hover)}
.ob-option-card:active{transform:scale(0.995)}
.ob-option-card.on{border-color:var(--ob-brand);background:var(--ob-brand-soft);box-shadow:0 0 0 1px var(--ob-brand)}
.ob-option-card.on .ob-option-label{color:var(--ob-brand)}
.ob-option-label{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:var(--ob-text-small);font-weight:var(--ob-weight-label);color:var(--ob-ink)}
.ob-option-label svg{width:16px;height:16px;flex:none;color:var(--ob-ink-muted)}
.ob-option-card.on .ob-option-label svg{color:var(--ob-brand)}
.ob-option-preview{display:flex;align-items:center;justify-content:center;min-height:56px;border-radius:calc(var(--ob-radius-control) - 4px);background:var(--ob-surface-muted);overflow:hidden}
.ob-option-hint{font-size:var(--ob-text-micro);line-height:1.5;color:var(--ob-ink-muted);overflow-wrap:anywhere}
.ob-theme-preview{display:flex;flex-direction:column;gap:5px;width:100%;height:100%;min-height:56px;padding:8px;border:1px solid var(--ob-preview-light-border);background:var(--ob-preview-light-canvas)}
.ob-theme-preview[data-theme-preview='dark']{border-color:var(--ob-preview-dark-border);background:var(--ob-preview-dark-canvas)}
.ob-theme-preview[data-theme-preview='system']{background:linear-gradient(135deg,var(--ob-preview-light-canvas) 0 49%,var(--ob-preview-dark-canvas) 51% 100%)}
.ob-theme-preview-bar{height:6px;border-radius:9999px;background:var(--ob-preview-light-border)}
.ob-theme-preview[data-theme-preview='dark'] .ob-theme-preview-bar{background:var(--ob-preview-dark-border)}
.ob-theme-preview .ob-theme-preview-surface{margin-top:auto;height:16px;border-radius:5px;background:var(--ob-preview-light-surface);border:1px solid var(--ob-preview-light-border)}
.ob-theme-preview[data-theme-preview='dark'] .ob-theme-preview-surface{background:var(--ob-preview-dark-surface);border-color:var(--ob-preview-dark-border)}
.ob-accent-grid{display:grid;width:100%;gap:8px;grid-template-columns:repeat(auto-fit,minmax(min(100%,130px),1fr))}
.ob-accent-card{display:flex;align-items:center;gap:8px;min-width:0;padding:8px 10px;border:1px solid var(--ob-border);border-radius:var(--ob-radius-control);background:var(--ob-surface);color:var(--ob-ink);cursor:pointer;font-size:var(--ob-text-small);text-align:start;transition:border-color var(--ob-dur-control) var(--ob-ease),background-color var(--ob-dur-control) var(--ob-ease)}
.ob-accent-card:hover{border-color:var(--ob-border-strong);background:var(--ob-hover)}
.ob-accent-card.on{border-color:var(--ob-brand);background:var(--ob-brand-soft)}
.ob-swatch{display:inline-block;flex:none;width:20px;height:20px;border-radius:9999px;border:1px solid color-mix(in srgb,var(--ob-ink) 16%,transparent);box-shadow:inset 0 0 0 2px var(--ob-surface)}
.ob-preview-density{display:flex;flex-direction:column;justify-content:center;gap:4px;width:100%;min-height:56px;padding:8px}
.ob-preview-density>span{display:flex;align-items:center;gap:5px}
.ob-preview-density>span>i{width:6px;height:6px;border-radius:9999px;background:var(--ob-brand);flex:none}
.ob-preview-density>span>b{height:3px;flex:1 1 auto;border-radius:9999px;background:var(--ob-border-strong)}
.ob-preview-density[data-density-preview='compact']{gap:3px;padding:6px}
.ob-preview-density[data-density-preview='comfortable']{gap:8px;padding:10px}
.ob-preview-font{display:grid;place-items:center;width:100%;min-height:56px;color:var(--ob-ink);line-height:1.2}
.ob-preview-font[data-font-preview='small']{font-size:var(--ob-text-small)}
.ob-preview-font[data-font-preview='standard']{font-size:var(--ob-text-section)}
.ob-preview-font[data-font-preview='large']{font-size:calc(var(--ob-text-section) * 1.2)}
.ob-preview-width{display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;padding:8px}
.ob-preview-width>span{display:block;height:32px;border-radius:var(--ob-radius-control);border:1px solid var(--ob-brand);background:var(--ob-brand-soft)}
.ob-preview-width[data-width-preview='standard']>span{width:66%}
.ob-preview-width[data-width-preview='wide']>span{width:84%}
.ob-preview-width[data-width-preview='auto']>span{width:100%}
.ob-settings-note{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px}

/* ---------- 表单控件 ---------- */
.ob-field{display:flex;flex-direction:column;gap:6px;min-width:0;padding:10px 0}
.ob-field + .ob-field{border-top:1px solid var(--ob-border)}
.ob-field-label{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:var(--ob-text-small);font-weight:var(--ob-weight-label);color:var(--ob-ink);overflow-wrap:anywhere}
.ob-field-help{margin:0;font-size:var(--ob-text-micro);line-height:1.6;color:var(--ob-ink-muted);overflow-wrap:anywhere}
.ob-field-control{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.ob-input,.ob-select,.ob-textarea{width:100%;min-width:0;height:var(--ob-control);padding:0 12px;border:1px solid var(--ob-border);border-radius:var(--ob-radius-control);background:var(--ob-surface);color:var(--ob-ink);font-size:var(--ob-text-body);outline:none;box-shadow:var(--ob-shadow-card);transition:border-color var(--ob-dur-control) var(--ob-ease),background-color var(--ob-dur-control) var(--ob-ease),box-shadow var(--ob-dur-control) var(--ob-ease)}
.ob-input::placeholder,.ob-textarea::placeholder{color:var(--ob-ink-dim)}
.ob-input:hover,.ob-select:hover,.ob-textarea:hover{border-color:var(--ob-border-strong)}
.ob-input:focus,.ob-select:focus,.ob-textarea:focus{border-color:var(--ob-brand);box-shadow:0 0 0 3px var(--ob-selection)}
.ob-input[disabled],.ob-select[disabled],.ob-textarea[disabled]{opacity:0.55;cursor:not-allowed}
.ob-textarea{height:auto;min-height:96px;padding:10px 12px;line-height:1.6;resize:vertical}
.ob-select{appearance:none;-webkit-appearance:none;padding-right:34px;cursor:pointer;background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23596579' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center}
body[data-ds-dark-theme] .ob-select{background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239aa6ba' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")}
.ob-input-wrap{position:relative;display:flex;align-items:center;width:100%;min-width:0}
.ob-input-wrap .ob-input{padding-right:72px}
.ob-secret-toggle{position:absolute;right:6px;top:50%;transform:translateY(-50%);height:calc(var(--ob-control) - 12px);padding:0 8px;border:0;border-radius:calc(var(--ob-radius-control) - 4px);background:transparent;color:var(--ob-ink-muted);font-size:var(--ob-text-micro);cursor:pointer;transition:background-color var(--ob-dur-control) var(--ob-ease),color var(--ob-dur-control) var(--ob-ease)}
.ob-secret-toggle:hover{background:var(--ob-hover-strong);color:var(--ob-ink)}
.ob-field-unit{flex:none;font-size:var(--ob-text-micro);color:var(--ob-ink-muted)}
.ob-field-error{margin:0;font-size:var(--ob-text-micro);color:var(--ob-danger)}
.ob-switch{position:relative;display:inline-flex;align-items:center;flex:none;width:44px;height:26px;padding:0;border:1px solid var(--ob-border-strong);border-radius:var(--ob-radius-pill);background:var(--ob-surface-muted);cursor:pointer;transition:background-color var(--ob-dur-standard) var(--ob-ease),border-color var(--ob-dur-standard) var(--ob-ease)}
.ob-switch::before{content:"";width:18px;height:18px;margin-left:3px;border-radius:var(--ob-radius-pill);background:var(--ob-surface);box-shadow:var(--ob-shadow-card);transform:translateX(0);transition:transform var(--ob-dur-standard) var(--ob-ease)}
.ob-switch.on{background:var(--ob-brand);border-color:transparent}
.ob-switch.on::before{background:var(--ob-on-brand);transform:translateX(18px)}
.ob-switch[disabled]{opacity:0.5;cursor:not-allowed}
.ob-tags{display:flex;flex-wrap:wrap;align-items:center;gap:6px;width:100%;min-width:0;min-height:var(--ob-control);padding:5px 8px;border:1px solid var(--ob-border);border-radius:var(--ob-radius-control);background:var(--ob-surface)}
.ob-tags:focus-within{border-color:var(--ob-brand);box-shadow:0 0 0 3px var(--ob-selection)}
.ob-tag{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border-radius:var(--ob-radius-pill);background:var(--ob-brand-soft);color:var(--ob-brand);font-size:var(--ob-text-micro);font-weight:var(--ob-weight-medium)}
.ob-tag button{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;padding:0;border:0;border-radius:var(--ob-radius-pill);background:transparent;color:inherit;cursor:pointer;font-size:12px;line-height:1}
.ob-tag button:hover{background:color-mix(in srgb,var(--ob-brand) 16%,transparent)}
.ob-tags input{flex:1 1 96px;min-width:80px;height:26px;border:0;background:transparent;outline:none;font-size:var(--ob-text-small);color:var(--ob-ink)}
.ob-number-list{display:flex;flex-wrap:wrap;align-items:center;gap:6px;width:100%}
.ob-number-list .ob-input{width:110px;flex:none}

/* ---------- 日志页 ---------- */
.ob-log{display:flex;flex-direction:column;gap:1px;min-width:0;max-height:min(62vh,620px);overflow:auto;padding:8px;border-radius:var(--ob-radius-control);background:var(--ob-surface-muted);font-family:var(--ob-font-mono)}
.ob-log-row{display:flex;align-items:baseline;gap:8px;min-width:0;padding:5px 8px;border-radius:calc(var(--ob-radius-control) - 4px);font-size:var(--ob-text-small);line-height:1.5;transition:background-color var(--ob-dur-control) var(--ob-ease)}
.ob-log-row:hover{background:var(--ob-hover)}
.ob-log-time{flex:none;color:var(--ob-ink-muted);font-size:var(--ob-text-micro);font-variant-numeric:tabular-nums}
.ob-log-level{flex:none;min-width:42px;font-size:var(--ob-text-micro);font-weight:var(--ob-weight-heading);letter-spacing:0.04em;text-transform:uppercase}
.ob-log-level.debug{color:var(--ob-ink-muted)}
.ob-log-level.info{color:var(--ob-info)}
.ob-log-level.warn{color:var(--ob-warning)}
.ob-log-level.error{color:var(--ob-danger)}
.ob-log-area{flex:none;color:var(--ob-ink-muted);font-size:var(--ob-text-micro)}
.ob-log-text{flex:1 1 auto;min-width:0;color:var(--ob-ink);overflow-wrap:anywhere;word-break:break-word}
.ob-live{display:inline-flex;align-items:center;gap:6px;font-size:var(--ob-text-micro);color:var(--ob-ink-muted)}

/* ---------- 空态 / 错误态 / 骨架 ---------- */
.ob-state{display:grid;place-items:center;text-align:center;min-height:14rem;padding:24px 16px}
.ob-state.compact{min-height:9rem;padding:16px}
.ob-state-icon{display:flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:var(--ob-radius-panel);background:var(--ob-surface-muted);color:var(--ob-ink-muted)}
.ob-state-icon.err{background:var(--ob-danger-soft);color:var(--ob-danger)}
.ob-state-icon.warn{background:var(--ob-warning-soft);color:var(--ob-warning)}
.ob-state-icon.ok{background:var(--ob-success-soft);color:var(--ob-success)}
.ob-state-icon.brand{background:var(--ob-brand-soft);color:var(--ob-brand)}
.ob-state-icon svg{width:22px;height:22px}
.ob-state-title{margin:14px 0 0;font-size:var(--ob-text-section);font-weight:var(--ob-weight-heading);color:var(--ob-ink)}
.ob-state-desc{max-width:26rem;margin:6px 0 0;font-size:var(--ob-text-small);line-height:1.65;color:var(--ob-ink-muted);overflow-wrap:anywhere}
.ob-state-action{margin-top:16px}
.ob-skeleton{display:block;border-radius:var(--ob-radius-control);background:var(--ob-skeleton)}
.ob-skeleton.strong{background:var(--ob-skeleton-strong)}
.ob-skeleton.text{height:12px;border-radius:var(--ob-radius-pill)}
.ob-skeleton.title{height:20px;border-radius:var(--ob-radius-pill)}
.ob-skeleton.card{height:96px;border-radius:var(--ob-radius-panel)}
.ob-skeleton.tile{height:112px;border-radius:var(--ob-radius-panel)}
.ob-skel-stack{display:flex;flex-direction:column;gap:10px}
.ob-skel-row{display:flex;align-items:center;gap:12px;min-width:0}
.ob-skel-grow{flex:1 1 auto;min-width:0}

/* ---------- 反馈：banner / toast / savebar ---------- */
.ob-banner{display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px 12px;padding:11px 14px;border:1px solid var(--ob-border);border-radius:var(--ob-radius-control);background:var(--ob-surface);color:var(--ob-ink);font-size:var(--ob-text-small);line-height:1.6;box-shadow:var(--ob-shadow-card)}
.ob-banner.ok{border-color:color-mix(in srgb,var(--ob-success) 22%,transparent);background:var(--ob-success-soft);color:var(--ob-success)}
.ob-banner.warn{border-color:color-mix(in srgb,var(--ob-warning) 22%,transparent);background:var(--ob-warning-soft);color:var(--ob-warning)}
.ob-banner.err{border-color:color-mix(in srgb,var(--ob-danger) 22%,transparent);background:var(--ob-danger-soft);color:var(--ob-danger)}
.ob-banner-msg{flex:1 1 220px;min-width:0;overflow-wrap:anywhere}
.ob-banner-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.ob-banner .ob-icon-tile{background:color-mix(in srgb,currentColor 12%,transparent);color:inherit}
.ob-toast{position:fixed;left:50%;bottom:24px;z-index:60;transform:translateX(-50%);display:flex;align-items:center;gap:9px;max-width:min(92vw,460px);padding:11px 16px;border-radius:var(--ob-radius-panel);background:var(--ob-surface);color:var(--ob-ink);font-size:var(--ob-text-small);font-weight:var(--ob-weight-medium);box-shadow:var(--ob-shadow-toast);border:1px solid var(--ob-border)}
.ob-toast.ok{border-color:color-mix(in srgb,var(--ob-success) 30%,transparent);color:var(--ob-success)}
.ob-toast.err{border-color:color-mix(in srgb,var(--ob-danger) 30%,transparent);color:var(--ob-danger)}
.ob-toast-mark{display:inline-flex;align-items:center;justify-content:center;flex:none;width:20px;height:20px;border-radius:var(--ob-radius-pill);background:color-mix(in srgb,currentColor 14%,transparent);font-size:var(--ob-text-micro);font-weight:var(--ob-weight-display)}
.ob-savebar{position:sticky;bottom:16px;z-index:8;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;margin-top:4px;padding:12px 16px;border:1px solid var(--ob-border);border-radius:var(--ob-radius-panel);background:color-mix(in srgb,var(--ob-surface) 92%,transparent);box-shadow:var(--ob-shadow-overlay);backdrop-filter:blur(16px) saturate(1.2);-webkit-backdrop-filter:blur(16px) saturate(1.2)}
.ob-savebar-msg{display:inline-flex;align-items:center;gap:8px;font-size:var(--ob-text-small);font-weight:var(--ob-weight-medium);color:var(--ob-ink);min-width:0}
.ob-savebar-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}

/* ---------- 关于页 ---------- */
.ob-about-hero{display:flex;flex-wrap:wrap;align-items:center;gap:16px 20px;min-width:0}
.ob-about-mark{display:flex;align-items:center;justify-content:center;flex:none;width:56px;height:56px;border-radius:var(--ob-radius-shell);background:var(--ob-brand);color:var(--ob-on-brand);box-shadow:var(--ob-shadow-card)}
.ob-about-mark svg{width:30px;height:30px}
.ob-about-detail{display:flex;flex-direction:column;gap:4px;min-width:0}
.ob-about-name{margin:0;font-size:var(--ob-text-title);font-weight:var(--ob-weight-display);letter-spacing:var(--ob-tracking-display);color:var(--ob-ink)}
.ob-about-desc{margin:0;font-size:var(--ob-text-small);line-height:1.6;color:var(--ob-ink-muted)}
.ob-code{display:inline-flex;align-items:center;max-width:100%;padding:3px 7px;border-radius:6px;background:var(--ob-surface-muted);font-family:var(--ob-font-mono);font-size:var(--ob-text-micro);color:var(--ob-ink-muted);overflow-wrap:anywhere}
.ob-link{display:inline-flex;align-items:center;gap:4px;color:var(--ob-brand);font-size:var(--ob-text-small);font-weight:var(--ob-weight-medium)}

/* ---------- 描述列表（KV） ---------- */
.ob-kv{display:flex;flex-direction:column;gap:0;margin:8px 0 0;padding:0}
.ob-kv-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;padding:9px 0;border-bottom:1px solid var(--ob-border);min-width:0}
.ob-kv-row:last-child{border-bottom:0;padding-bottom:0}
.ob-kv-k{flex:0 0 132px;margin:0;font-size:var(--ob-text-small);color:var(--ob-ink-muted);overflow-wrap:anywhere}
.ob-kv-v{flex:1 1 200px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;margin:0;font-size:var(--ob-text-small);font-weight:var(--ob-weight-medium);color:var(--ob-ink);overflow-wrap:anywhere}

/* ---------- 响应式 ---------- */
.ob-cog-footer{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 4px 0;border-top:1px solid var(--ob-border);margin-top:12px}
.ob-cog-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px}
.ob-cog-search{flex:1 1 220px;max-width:420px;position:relative}
.ob-cog-search .ob-input{padding-left:34px}
.ob-cog-search > svg{position:absolute;left:10px;color:var(--ob-ink-dim);pointer-events:none}
.ob-cog-meter{display:flex;flex-direction:column;gap:4px;min-width:0}
.ob-cog-meter-head{display:flex;justify-content:space-between;gap:8px;font-size:var(--ob-text-micro);color:var(--ob-ink-muted)}
.ob-meter{height:7px;border-radius:var(--ob-radius-pill);background:var(--ob-surface-inset);overflow:hidden}
.ob-meter-fill{height:100%;border-radius:inherit;background:var(--ob-brand);transition:width var(--ob-dur-standard) var(--ob-ease)}
.ob-cog-bars{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));margin-top:10px}
.ob-cog-card{display:flex;flex-direction:column;gap:6px;min-width:0;padding:10px 12px;border:1px solid var(--ob-border);border-radius:var(--ob-radius-control);background:var(--ob-surface-raised)}
.ob-cog-card:hover{border-color:var(--ob-border-strong)}
.ob-cog-divider{height:1px;background:var(--ob-border);margin:10px 0}
.ob-cog-line{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;padding:4px 0;font-size:var(--ob-text-small)}
.ob-cog-facet{display:flex;flex-direction:column;gap:4px;padding:8px 0;border-bottom:1px solid var(--ob-border)}
.ob-cog-facet:last-child{border-bottom:0}
.ob-cog-history{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--ob-border);font-size:var(--ob-text-small)}
.ob-cog-history:last-child{border-bottom:0}
.ob-cog-memory-text{font-size:var(--ob-text-small);line-height:1.65;color:var(--ob-ink);margin:0;overflow-wrap:anywhere}
.ob-cog-detail{margin-top:4px;padding-top:6px;border-top:1px dashed var(--ob-border)}
.ob-cog-sliders{display:grid;gap:10px 18px;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));margin-top:8px}
.ob-cog-slider{display:flex;flex-direction:column;gap:4px;min-width:0}
.ob-cog-slider-head{display:flex;justify-content:space-between;gap:8px;font-size:var(--ob-text-micro);color:var(--ob-ink-muted)}
.ob-cog-slider input[type="range"]{width:100%;accent-color:var(--ob-brand);cursor:pointer}
.ob-persona-prompt{margin:0;padding:12px 14px;border:1px solid var(--ob-border);border-radius:var(--ob-radius-control);background:var(--ob-surface-sunken);color:var(--ob-ink);font:12px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-break:break-word;max-height:380px;overflow:auto}
.ob-persona-subtitle{margin:14px 0 6px;font-size:var(--ob-text-small);font-weight:var(--ob-weight-heading);color:var(--ob-ink)}
.ob-persona-subtitle:first-child{margin-top:0}
.ob-persona-library{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.ob-persona-select{width:auto;min-width:min(100%,240px);flex:0 1 280px}
.ob-persona-create{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}
.ob-persona-create .ob-input{flex:1 1 260px;width:auto;min-width:0}
.ob-persona-data-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.ob-persona-data-copy{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px}
.ob-persona-data-copy .ob-select{width:auto;min-width:min(100%,180px);flex:0 1 220px}
.ob-persona-data-groups{display:flex;flex-wrap:wrap;gap:8px 12px;min-width:0}
.ob-check{display:inline-flex;align-items:center;gap:6px;font-size:var(--ob-text-small);color:var(--ob-ink);cursor:pointer}
.ob-check input{accent-color:var(--ob-brand)}
.ob-persona-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px;min-width:0}
.ob-persona-file{max-width:min(100%,260px);font-size:var(--ob-text-small)}
.ob-oktext{color:var(--ob-brand)}
.ob-errtext{color:var(--ob-err,var(--ob-brand))}
.ob-diagnostic-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.ob-cog-person-select{display:flex;align-items:center;gap:10px;width:100%;min-width:0;padding:0;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}
.ob-cog-person-select:focus-visible{outline:2px solid var(--ob-brand);outline-offset:2px;border-radius:var(--ob-radius-control)}
.ob-models-grid{display:grid;gap:var(--ob-control-gap);grid-template-columns:minmax(240px,320px) minmax(0,1fr);align-items:start}
.ob-model-provider{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-width:0;padding:10px 12px;border:1px solid var(--ob-border);border-radius:var(--ob-radius-control);background:var(--ob-surface-raised);color:inherit;text-align:left;cursor:pointer}
.ob-model-provider:hover{border-color:var(--ob-border-strong);background:var(--ob-hover)}
.ob-model-provider.on{border-color:color-mix(in srgb,var(--ob-brand) 32%,transparent);background:var(--ob-brand-soft)}
.ob-model-provider-main{display:flex;flex-direction:column;gap:3px;min-width:0}
.ob-model-advanced{border:1px dashed var(--ob-border);border-radius:var(--ob-radius-control);padding:8px 10px}
.ob-model-advanced summary{cursor:pointer;font-size:var(--ob-text-small);color:var(--ob-ink-muted)}
.ob-model-test{padding:10px 12px;border-radius:var(--ob-radius-control);border:1px solid var(--ob-border);background:var(--ob-surface-muted)}
.ob-model-test.ok{border-color:color-mix(in srgb,var(--ob-success) 30%,var(--ob-border))}
.ob-model-test.err{border-color:color-mix(in srgb,var(--ob-danger) 30%,var(--ob-border))}
.ob-model-test p{margin:4px 0 0;overflow-wrap:anywhere}
.ob-model-discovery{margin-top:4px;padding-top:8px;border-top:1px dashed var(--ob-border)}
.ob-model-candidates{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;max-height:180px;overflow:auto}
.ob-model-candidate{font-size:var(--ob-text-micro);padding:2px 8px;border:1px solid var(--ob-border);border-radius:var(--ob-radius-pill);background:var(--ob-surface-raised);overflow-wrap:anywhere}
.ob-model-protocols{display:grid;gap:6px;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))}
.ob-model-protocol{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border:1px solid var(--ob-border);border-radius:var(--ob-radius-control);background:var(--ob-surface-raised)}
.ob-media-grid{display:grid;gap:var(--ob-control-gap);grid-template-columns:repeat(auto-fill,minmax(min(100%,180px),1fr))}
.ob-media-card{display:flex;flex-direction:column;gap:10px;min-width:0;padding:10px;border:1px solid var(--ob-border);border-radius:var(--ob-radius-panel);background:var(--ob-surface-raised)}
.ob-media-image{display:block;width:100%;aspect-ratio:1;object-fit:contain;border-radius:var(--ob-radius-control);background:var(--ob-surface-muted)}
.ob-media-name{margin:0;font-size:var(--ob-text-small);font-weight:var(--ob-weight-heading);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ob-media-file{max-width:min(100%,300px);font-size:var(--ob-text-small)}
@media (max-width:960px){
  .ob-models-grid{grid-template-columns:minmax(0,1fr)}
}
@media (max-width:960px){
  .ob-split{grid-template-columns:minmax(0,1fr)}
  .ob-settings{grid-template-columns:minmax(0,1fr)}
  .ob-settings-nav{position:static;flex-direction:row;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}
  .ob-settings-nav::-webkit-scrollbar{display:none}
  .ob-settings-nav-btn{flex:none;white-space:nowrap}
  .ob-settings-nav-title{display:none}
}
@media (max-width:640px){
  .ob-shell{padding:0 16px}
  .ob-page{padding-top:12px;gap:12px}
  .ob-tabs{padding:8px 0 10px}
  .ob-stat-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,136px),1fr))}
  .ob-bar-row{grid-template-columns:minmax(48px,84px) minmax(0,1fr) auto}
}
@media (max-width:420px){
  .ob-shell{padding:0 12px}
  .ob-panel-head{padding:14px 14px 8px}
  .ob-panel-body{padding:8px 14px 14px}
  .ob-hero-facts{grid-template-columns:minmax(0,1fr)}
  .ob-btn{padding:0 12px}
  .ob-toast{left:12px;right:12px;transform:none;max-width:none}
}
/* The six areas stay inside the existing main slot. */
      .ob-sandbox { min-width:0; }
      .ob-sandbox-badge { display:inline-block; padding:8px 12px; border:2px solid currentColor; border-radius:8px; }
      .ob-sandbox-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
      .ob-sandbox .ob-row { flex-wrap:wrap; }
      .ob-sandbox select { max-width:100%; }
      .ob-sandbox-json { white-space:pre-wrap; overflow-wrap:anywhere; max-height:360px; overflow:auto; font-size:12px; }
      .ob-sandbox-transcript { padding-left:24px; overflow-wrap:anywhere; white-space:pre-wrap; }
      @media (max-width:900px) { .ob-sandbox-grid { grid-template-columns:minmax(0,1fr); } }

/* DSH owns the sidebar; both navigation rows stay above full-width content. */
.ob-commandbar{position:sticky;top:0;z-index:30;width:100%;min-width:0;padding-top:env(safe-area-inset-top,0px);background:var(--ob-canvas);border-bottom:1px solid var(--ob-border)}
.ob-commandbar-main{display:flex;align-items:center;gap:12px;min-width:0;min-height:56px}
.ob-command-brand{display:flex;align-items:center;gap:6px;flex:none;max-width:28%;min-width:0;font-size:var(--ob-text-small);white-space:nowrap}
.ob-command-brand strong{overflow:hidden;text-overflow:ellipsis;font-weight:var(--ob-weight-heading)}
.ob-command-version{color:var(--ob-ink-muted);font-size:var(--ob-text-micro)}
.ob-command-status{display:inline-flex;color:var(--ob-ink-muted)}
.ob-command-status.ok{color:var(--ob-success)}
.ob-command-status.warn{color:var(--ob-warning)}
.ob-command-status.err{color:var(--ob-danger)}
.ob-area-tabs,.ob-sectionbar{display:flex;align-items:center;gap:4px;min-width:0;max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin}
.ob-area-tabs{flex:1 1 0}
.ob-sectionbar{padding:4px 0;min-height:52px}
.ob-area-tab,.ob-section-chip{flex:none;min-width:44px;min-height:44px;padding:8px 12px;border:0;border-radius:var(--ob-radius-control);background:transparent;color:var(--ob-ink-muted);font:inherit;white-space:nowrap;cursor:pointer}
.ob-area-tab[aria-current=true],.ob-section-chip[aria-current=page]{background:var(--ob-brand-soft);color:var(--ob-brand)}
.ob-command-select,.ob-section-select-row{display:none}
.ob-command-actions{display:flex;align-items:center;gap:4px;flex:none}
.ob-command-actions button{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;padding:0;border:0;border-radius:var(--ob-radius-control);background:transparent;color:var(--ob-ink);cursor:pointer}
.ob-palette-overlay{position:fixed;inset:0;z-index:100;display:flex;align-items:flex-start;justify-content:center;padding:clamp(12px,8vh,80px) max(12px,env(safe-area-inset-right,0px)) max(12px,env(safe-area-inset-bottom,0px)) max(12px,env(safe-area-inset-left,0px));background:var(--ob-scrim);overscroll-behavior:contain}
.ob-palette{width:min(640px,100%);min-width:0;max-height:80vh;max-height:80dvh;display:flex;flex-direction:column;padding:16px;border:1px solid var(--ob-border);border-radius:var(--ob-radius-panel);background:var(--ob-surface);color:var(--ob-ink);box-shadow:var(--ob-shadow-card)}
.ob-palette-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.ob-palette-title{margin:0;font-size:var(--ob-text-body);font-weight:var(--ob-weight-heading)}
.ob-palette-close{min-width:44px;min-height:44px;border:0;background:transparent;color:var(--ob-ink);cursor:pointer}
.ob-palette-results{min-height:0;overflow-y:auto;overscroll-behavior:contain;margin-top:8px}
.ob-palette-option{display:block;width:100%;min-height:44px;padding:10px 12px;border:0;border-radius:var(--ob-radius-control);background:transparent;color:var(--ob-ink);text-align:left;white-space:normal;overflow-wrap:anywhere;cursor:pointer}
.ob-palette-option[aria-selected=true]{background:var(--ob-brand-soft);color:var(--ob-brand)}
.ob-page,.ob-content,.ob-shell > *{min-width:0}
.ob-content :is([id],[data-setting-path]){scroll-margin-top:calc(var(--ob-commandbar-height) + 12px)}
@media (max-width:900px){
  /* Reserve space for up to three wrapped 44px controls, padding and the safe area. */
  .ob-root:has(.ob-module-savebar,.ob-owner-savebar){scroll-padding-bottom:calc(12rem + env(safe-area-inset-bottom,0px))}
  .ob-module-savebar,.ob-owner-savebar{position:sticky;bottom:0;z-index:20;padding:12px 12px calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--ob-border);background:var(--ob-surface)}
  .ob-module-savebar > .ob-btn,.ob-owner-savebar > .ob-btn{flex:1 1 8rem;height:auto;min-height:44px;white-space:normal;overflow-wrap:anywhere}
  .ob-module-scope :is(input,select,textarea,[tabindex],.ob-banner),.ob-owner-settings :is([data-setting-path],input,select,textarea,[tabindex],.ob-banner){scroll-margin-block:calc(var(--ob-commandbar-height) + 12px) 12px}
  .ob-commandbar-main{gap:8px;height:56px;min-height:56px;max-height:56px;flex-wrap:nowrap}
  .ob-command-brand{gap:4px;max-width:64px}
  .ob-command-version{display:none}
  .ob-command-actions{gap:0}
  .ob-root .ob-area-tabs,.ob-root .ob-sectionbar{display:none}
  .ob-command-select,.ob-section-select-row{display:flex;align-items:center;gap:6px;min-width:0;margin:0;font-size:var(--ob-text-small);line-height:1}
  .ob-command-select{flex:1}
  .ob-section-select-row{height:44px;max-height:44px}
  .ob-command-select > span,.ob-section-select-row > span{flex:none}
  .ob-root .ob-command-select select,.ob-root .ob-section-select-row select{flex:1;width:0;min-width:0;max-width:100%;height:44px;min-height:44px;padding:0 24px 0 6px;border:0;border-radius:var(--ob-radius-control);background:var(--ob-surface);color:var(--ob-ink);font-size:16px}
  .ob-root .ob-shell{padding-left:max(12px,env(safe-area-inset-left,0px));padding-right:max(12px,env(safe-area-inset-right,0px))}
  .ob-root{padding-bottom:calc(48px + env(safe-area-inset-bottom,0px))}
  .ob-root input,.ob-root select,.ob-root textarea{font-size:16px}
  .ob-root button,.ob-root input:not([type=checkbox]):not([type=radio]),.ob-root select{min-height:44px}
  .ob-root button{min-width:44px;max-width:100%;white-space:normal}
  .ob-root .ob-grid,.ob-root .ob-grid.two,.ob-root .ob-stat-grid,.ob-root .ob-models-grid,.ob-root .ob-split,.ob-root .ob-settings,.ob-root .ob-sandbox-grid{grid-template-columns:minmax(0,1fr)}
  .ob-header,.ob-panel-head,.ob-row,.ob-spread{flex-wrap:wrap;min-width:0}
  .ob-root .ob-page,.ob-root .ob-content,.ob-root .ob-panel{overflow-wrap:anywhere}
  .ob-root pre{max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere}
  .ob-root img,.ob-root video,.ob-root canvas{max-width:100%}
}
@media (pointer:coarse){
  .ob-input,.ob-select,.ob-textarea,.ob-tags input{font-size:16px}
  .ob-tab{height:var(--ob-control)}
}
@media (hover:none){
  .ob-stat:hover{transform:none;box-shadow:var(--ob-shadow-card);border-color:var(--ob-border)}
}
`

    // =====================================================================
    // 样式注入 + 动效运行时（Motion Policy / Reveal / AsyncRegion / Presence /
    // Trickle Progress / CountUp / Now ticker / Tab 指示器）
    // 只做语义与生命周期，具体时长/缓动全部来自 TOKEN_CSS / MOTION_CSS。
    // =====================================================================

    function ensureStyleElement() {
      if (typeof document === 'undefined' || !document.head) return null
      const existing = document.getElementById(STYLE_ID)
      if (existing) {
        // 同页插件热更新时替换为新样式，避免残留旧 CSS。
        existing.textContent = TOKEN_CSS + MOTION_CSS + PANEL_CSS
        return existing
      }
      const el = document.createElement('style')
      el.id = STYLE_ID
      el.textContent = TOKEN_CSS + MOTION_CSS + PANEL_CSS
      document.head.appendChild(el)
      return el
    }

    function installStyle(ctx) {
      if (typeof document === 'undefined' || !document.head) return
      const mount = () => {
        ensureStyleElement()
        return () => {
          try {
            const el = document.getElementById(STYLE_ID)
            if (el && el.parentNode) el.parentNode.removeChild(el)
          } catch (error) {}
        }
      }
      if (ctx && typeof ctx.effect === 'function') {
        try {
          ctx.effect(mount, 'onebot-qq: 面板样式')
          return
        } catch (error) {}
      }
      try {
        mount()
      } catch (error) {}
    }

    function usePanelStyle() {
      useEffect(() => {
        ensureStyleElement()
      }, [])
    }

    function cx() {
      const parts = []
      for (let i = 0; i < arguments.length; i += 1) {
        const value = arguments[i]
        if (value) parts.push(value)
      }
      return parts.join(' ')
    }

    // ---- Motion Policy：system / full / reduced / off ----

    const DEFAULT_MOTION = { mode: 'full', systemReduced: false, categories: motionCategories('full') }
    const MotionContext = React.createContext(DEFAULT_MOTION)

    /** 读取系统 prefers-reduced-motion 并保持更新（只读监听，不写全局状态）。 */
    function useSystemReducedMotion() {
      const [reduced, setReduced] = useState(() => prefersReducedMotion())
      useEffect(() => {
        let media = null
        try {
          if (typeof matchMedia !== 'function') return undefined
          media = matchMedia('(prefers-reduced-motion: reduce)')
        } catch (error) {
          return undefined
        }
        const onChange = () => setReduced(media.matches === true)
        try {
          if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange)
          else if (typeof media.addListener === 'function') media.addListener(onChange)
        } catch (error) {}
        return () => {
          try {
            if (typeof media.removeEventListener === 'function') media.removeEventListener('change', onChange)
            else if (typeof media.removeListener === 'function') media.removeListener(onChange)
          } catch (error) {}
        }
      }, [])
      return reduced
    }

    function useMotionPreference(pref) {
      const systemReduced = useSystemReducedMotion()
      return useMemo(() => {
        const mode = resolveMotionMode(pref, systemReduced)
        return { mode, systemReduced, categories: motionCategories(mode) }
      }, [pref, systemReduced])
    }

    /** 读取系统 prefers-contrast（ui.contrast=system 时使用）。 */
    function useSystemMoreContrast() {
      const [more, setMore] = useState(() => prefersMoreContrast())
      useEffect(() => {
        let media = null
        try {
          if (typeof matchMedia !== 'function') return undefined
          media = matchMedia('(prefers-contrast: more)')
        } catch (error) {
          return undefined
        }
        const onChange = () => setMore(media.matches === true)
        try {
          if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange)
          else if (typeof media.addListener === 'function') media.addListener(onChange)
        } catch (error) {}
        return () => {
          try {
            if (typeof media.removeEventListener === 'function') media.removeEventListener('change', onChange)
            else if (typeof media.removeListener === 'function') media.removeListener(onChange)
          } catch (error) {}
        }
      }, [])
      return more
    }

    // ---- DSH 全局主题桥：系统设置页通过 theme service 切换整个 DSH 的主题 ----

    let clientThemeBridge = null

    function readClientService(ctx, key) {
      try {
        return ctx && typeof ctx.get === 'function' ? ctx.get(key) : undefined
      } catch (error) {
        return undefined
      }
    }

    /**
     * 绑定 DSH 的 theme service（客户端公开服务）：getTheme / setTheme，
     * 用 theme/change 事件同步外部（DSH 自身设置页）的主题变化。
     * 服务不存在时保持 null，设置页会优雅禁用主题区。
     */
    function bindClientTheme(ctx) {
      const theme = (ctx && ctx.theme) || readClientService(ctx, 'theme')
      if (!theme || typeof theme.getTheme !== 'function' || typeof theme.setTheme !== 'function') return null
      const bridge = {
        getSnapshot: () => {
          try {
            return theme.getTheme()
          } catch (error) {
            return null
          }
        },
        setTheme: (id) => {
          try {
            theme.setTheme(String(id))
          } catch (error) {
            try {
              console.warn('[dsh-bot] 主题切换失败：', error)
            } catch (inner) {}
          }
        },
        subscribe: (listener) => {
          if (!ctx || typeof ctx.on !== 'function') return () => {}
          try {
            const off = ctx.on('theme/change', () => listener())
            return typeof off === 'function' ? off : () => {}
          } catch (error) {
            return () => {}
          }
        },
      }
      clientThemeBridge = bridge
      if (ctx && typeof ctx.effect === 'function') {
        try {
          ctx.effect(() => () => {
            if (clientThemeBridge === bridge) clientThemeBridge = null
          }, 'onebot-qq: theme bridge')
        } catch (error) {}
      }
      return bridge
    }

    /** 订阅 DSH 主题快照；无 theme service 时 available=false。 */
    function useClientTheme() {
      const bridge = clientThemeBridge
      const [snapshot, setSnapshot] = useState(() => (bridge ? bridge.getSnapshot() : null))
      useEffect(() => {
        if (!bridge) {
          setSnapshot(null)
          return undefined
        }
        setSnapshot(bridge.getSnapshot())
        const off = bridge.subscribe(() => setSnapshot(bridge.getSnapshot()))
        return typeof off === 'function' ? off : undefined
      }, [bridge])
      return {
        available: Boolean(bridge),
        snapshot,
        preference: snapshot && snapshot.preference ? String(snapshot.preference) : '',
        activeScheme: snapshot && snapshot.active && snapshot.active.colorScheme ? String(snapshot.active.colorScheme) : '',
        themes: snapshot && Array.isArray(snapshot.themes) ? snapshot.themes : [],
        setTheme: bridge ? bridge.setTheme : null,
      }
    }

    function useMotion() {
      return useContext(MotionContext)
    }

    // ---- Viewport Reveal（单例 IntersectionObserver，只播放一次） ----

    const revealCallbacks = new Map()
    let revealObserver = null

    function ensureRevealObserver() {
      if (revealObserver) return revealObserver
      if (typeof IntersectionObserver === 'undefined') return null
      try {
        revealObserver = new IntersectionObserver((entries) => {
          const latest = new Map()
          for (const entry of entries) {
            const previous = latest.get(entry.target)
            if (!previous || entry.time >= previous.time) latest.set(entry.target, entry)
          }
          const sorted = [...latest.values()].sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left,
          )
          let order = 0
          for (const entry of sorted) {
            const callback = revealCallbacks.get(entry.target)
            if (!callback) continue
            revealCallbacks.delete(entry.target)
            try {
              revealObserver.unobserve(entry.target)
            } catch (error) {}
            // 从上往下已滚过的区块不重播，直接显示。
            const aboveViewport = !entry.isIntersecting && entry.boundingClientRect.bottom <= 0
            callback(aboveViewport ? -1 : order)
            if (entry.isIntersecting) order += 1
          }
        }, { rootMargin: '0px', threshold: 0 })
      } catch (error) {
        revealObserver = null
      }
      return revealObserver
    }

    /**
     * Reveal 容器：首次进入视口时淡入 + 8px 抬升；同批按阅读顺序 stagger 40ms/项（上限 120ms）。
     * reduced/off/无 IntersectionObserver 时立即显示，不创建动画。
     */
    function Reveal(props) {
      const motion = useMotion()
      const enabled = Boolean(motion && motion.mode === 'full' && motion.categories.reveal)
      const Tag = props.as || 'div'
      const elementRef = useRef(null)
      const [revealed, setRevealed] = useState(!enabled)

      useEffect(() => {
        const element = elementRef.current
        if (!element) return undefined
        if (!enabled) {
          element.dataset.reveal = 'revealed'
          setRevealed(true)
          return undefined
        }
        element.dataset.reveal = 'pending'
        const observer = ensureRevealObserver()
        if (!observer) {
          element.dataset.reveal = 'revealed'
          setRevealed(true)
          return undefined
        }
        const callback = (order) => {
          if (order >= 0) element.style.setProperty('--ob-reveal-delay', revealDelayMs(order) + 'ms')
          else element.style.removeProperty('--ob-reveal-delay')
          element.dataset.reveal = 'revealed'
          setRevealed(true)
        }
        revealCallbacks.set(element, callback)
        try {
          observer.observe(element)
        } catch (error) {}
        // 安全兜底：布局异常/不可见容器不会一直停在 pending。
        const fallbackTimer = setTimeout(() => {
          if (element.dataset.reveal !== 'revealed') callback(-1)
        }, 1600)
        return () => {
          clearTimeout(fallbackTimer)
          revealCallbacks.delete(element)
          try {
            observer.unobserve(element)
          } catch (error) {}
        }
      }, [enabled])

      const rest = Object.assign({}, props)
      delete rest.as
      delete rest.className
      delete rest.children
      return h(
        Tag,
        Object.assign({}, rest, {
          ref: elementRef,
          className: cx('ob-reveal', props.className),
          'data-reveal': revealed ? 'revealed' : 'pending',
        }),
        props.children,
      )
    }

    // ---- AsyncRegion：initial 骨架 / refresh 保留内容 / error / empty ----

    function AsyncRegion(props) {
      const motion = useMotion()
      const phase = props.phase || 'initial'
      const contentAvailable = phase === 'ready' || phase === 'refreshing' || phase === 'background'
      const [entering, setEntering] = useState(false)
      const previousPhase = useRef(phase)
      useEffect(() => {
        const previous = previousPhase.current
        previousPhase.current = phase
        if (phase !== 'ready' || previous === 'refreshing' || previous === 'background' || previous === 'ready') return
        if (!shouldAnimate(motion && motion.mode, 'async')) return
        setEntering(true)
        const timer = setTimeout(() => setEntering(false), 400)
        return () => clearTimeout(timer)
      }, [phase, motion])
      const contentClass = cx('ob-async-content', contentAvailable ? 'is-ready' : '', entering ? pageTransitionClass('default') : '')
      return h(
        'div',
        { className: 'ob-async', role: 'region', 'aria-label': props.label || '内容', 'aria-busy': phase === 'initial' || phase === 'refreshing' ? true : undefined },
        phase === 'initial' ? props.skeleton || null : null,
        phase === 'error' ? props.error || null : null,
        phase === 'empty' ? props.empty || null : null,
        phase === 'refreshing' ? props.refreshing || null : null,
        h(
          'div',
          { className: contentClass, hidden: !contentAvailable },
          props.children,
        ),
      )
    }

    // ---- Feedback Presence：enter / stable / exit ----

    function Presence(props) {
      const motion = useMotion()
      const enabled = Boolean(motion && motion.mode === 'full')
      const visible = Boolean(props.visible)
      const [phase, setPhase] = useState(visible ? (enabled ? 'enter' : 'stable') : 'unmounted')
      const elementRef = useRef(null)

      useEffect(() => {
        setPhase((previous) => {
          if (!enabled) return visible ? 'stable' : 'unmounted'
          return nextPresence(previous, visible)
        })
      }, [enabled, visible])

      useEffect(() => {
        if (!enabled) return undefined
        const element = elementRef.current
        if (!element) return undefined
        const onEnd = () => setPhase((previous) => nextPresence(previous, visible))
        element.addEventListener('animationend', onEnd)
        return () => element.removeEventListener('animationend', onEnd)
      }, [enabled, visible, phase])

      if (phase === 'unmounted') return null
      const exiting = phase === 'exit'
      const rest = Object.assign({}, props)
      delete rest.visible
      delete rest.className
      delete rest.children
      return h(
        'div',
        Object.assign({}, rest, {
          ref: elementRef,
          className: cx('ob-presence', props.className),
          'data-presence': phase,
          'aria-hidden': exiting ? true : undefined,
          inert: exiting ? '' : undefined,
        }),
        props.children,
      )
    }

    // ---- progress.trickle：显式操作的顶部进度 ----

    function useTrickleProgress(active, motion) {
      const enabled = Boolean(motion && motion.mode === 'full')
      const [phase, setPhase] = useState('idle')
      const phaseRef = useRef('idle')
      phaseRef.current = phase
      const timerRef = useRef(null)
      useEffect(() => {
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        if (!enabled) {
          setPhase('idle')
          return undefined
        }
        if (active) {
          setPhase('pending')
          return undefined
        }
        if (phaseRef.current === 'pending') {
          setPhase('completing')
          timerRef.current = setTimeout(() => {
            setPhase('idle')
            timerRef.current = null
          }, 360)
        } else if (phaseRef.current !== 'completing') {
          setPhase('idle')
        }
        return () => {
          if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
          }
        }
      }, [active, enabled])
      return enabled ? phase : 'idle'
    }

    // ---- 数字滚动（默认 240ms ease-out；reduced/off 直接跳值） ----

    function useCountUp(value, motion, duration) {
      const target = Number(value)
      const numeric = value !== null && value !== '' && Number.isFinite(target)
      const [display, setDisplay] = useState(numeric ? target : value)
      const fromRef = useRef(numeric ? 0 : null)
      const frameRef = useRef(0)
      useEffect(() => {
        if (!numeric) {
          setDisplay(value)
          return undefined
        }
        const animate = Boolean(motion && motion.mode === 'full')
        if (!animate) {
          fromRef.current = target
          setDisplay(target)
          return undefined
        }
        const from = Number.isFinite(fromRef.current) ? fromRef.current : 0
        const start = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
        const total = Math.max(120, Number(duration) || 240)
        const step = (now) => {
          const progress = Math.min(1, (now - start) / total)
          setDisplay(countUpValue(from, target, progress))
          if (progress < 1) frameRef.current = requestAnimationFrame(step)
          else fromRef.current = target
        }
        frameRef.current = requestAnimationFrame(step)
        return () => {
          if (frameRef.current) cancelAnimationFrame(frameRef.current)
        }
      }, [numeric, target, motion && motion.mode, duration])
      return numeric ? display : value
    }

    /** 相对时间/连接时长的低频心跳：5s 一次，页面隐藏时暂停。 */
    function useNow(intervalMs) {
      const [now, setNow] = useState(() => Date.now())
      useEffect(() => {
        const timer = setInterval(() => {
          if (pageHidden()) return
          setNow(Date.now())
        }, Math.max(1000, Number(intervalMs) || 5000))
        return () => clearInterval(timer)
      }, [intervalMs])
      return now
    }

    /** Tab 滑块指示器：测量当前 tab 的偏移与宽度，写入 CSS 变量。 */
    function useTabIndicator(current, motion, deps) {
      const listRef = useRef(null)
      const [indicator, setIndicator] = useState({ transform: 'translateX(0px)', width: '0px' })
      const measure = useCallback(() => {
        const list = listRef.current
        if (!list) return
        let button = null
        try {
          button = list.querySelector('[data-tab-id="' + current + '"]')
        } catch (error) {
          button = null
        }
        if (!button || !button.getBoundingClientRect) {
          setIndicator({ transform: 'translateX(0px)', width: '0px' })
          return
        }
        const listRect = list.getBoundingClientRect()
        const rect = button.getBoundingClientRect()
        const left = rect.left - listRect.left + (list.scrollLeft || 0)
        setIndicator({ transform: 'translateX(' + Math.max(0, left) + 'px)', width: Math.max(0, rect.width) + 'px' })
      }, [current])
      useLayoutEffect(() => {
        measure()
      }, [measure].concat(deps || []))
      useEffect(() => {
        ensureResizeListener()
        allResizeListeners.push(measure)
        return () => {
          const index = allResizeListeners.indexOf(measure)
          if (index >= 0) allResizeListeners.splice(index, 1)
        }
      }, [measure])
      useEffect(() => {
        const list = listRef.current
        if (!list) return
        let button = null
        try {
          button = list.querySelector('[data-tab-id="' + current + '"]')
        } catch (error) {
          button = null
        }
        if (!button || !button.getBoundingClientRect || !list.scrollTo) return
        const listRect = list.getBoundingClientRect()
        const rect = button.getBoundingClientRect()
        if (rect.left < listRect.left + 8 || rect.right > listRect.right - 8) {
          const smooth = shouldAnimate(motion && motion.mode, 'screen')
          try {
            list.scrollTo({ left: Math.max(0, list.scrollLeft + rect.left - listRect.left - 12), behavior: smooth ? 'smooth' : 'auto' })
          } catch (error) {}
        }
      }, [current, motion])
      return { listRef, indicator }
    }

    // 窗口尺寸变化时统一重测（单例监听，避免每个组件各自 addEventListener）。
    const allResizeListeners = []
    let resizeBound = false
    function ensureResizeListener() {
      if (resizeBound || typeof window === 'undefined') return
      resizeBound = true
      try {
        window.addEventListener('resize', () => {
          for (const listener of allResizeListeners.slice()) {
            try {
              listener()
            } catch (error) {}
          }
        })
      } catch (error) {}
    }

    function BusyIndicator(props) {
      return h(
        'span',
        { className: 'ob-hint-inline', role: 'status', 'aria-label': props.label || '处理中' },
        h('i', { className: 'ob-spinner ob-spin', 'aria-hidden': true }),
        props.showLabel === false ? null : h('span', null, props.label || '处理中…'),
      )
    }

    // =====================================================================
    // UI 原语：图标 / 页头 / 面板 / 统计 / 状态 / 骨架 / 标签栏 / 表单控件 / 列表行
    // 全部为无依赖的 React.createElement 组件（单文件浏览器 bundle，不用 JSX）。
    // =====================================================================

    const ICON_PATHS = {
      overview: ['M4 4h7v7H4z', 'M13 4h7v4h-7z', 'M13 10h7v10h-7z', 'M4 13h7v7H4z'],
      connect: ['M9 7V4a3 3 0 0 1 6 0v3', 'M7 7h10v5a5 5 0 0 1-10 0z', 'M12 17v3'],
      message: ['M4 6h16v10H8l-4 3z', 'M8 10h8', 'M8 13h5'],
      config: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3', 'M4.9 4.9l2.1 2.1', 'M17 17l2.1 2.1', 'M19.1 4.9 17 7', 'M7 17l-2.1 2.1'],
      palette: ['M12 21a9 9 0 1 1 0-18c4.4 0 8 2.9 8 6.5 0 2.3-1.8 3.5-4 3.5h-1.2a1.8 1.8 0 0 0-1.3 3.1c.4.4.5.9.5 1.4 0 1.4-1 2.5-2 2.5z', 'M7.5 11h.01', 'M11 7.5h.01', 'M15.5 9h.01'],
      layout: ['M4 4h16v16H4z', 'M4 9h16', 'M9 9v11'],
      sparkles: ['M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z', 'M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z', 'M5 15l.6 1.6L7 17l-1.4.4L5 19l-.6-1.6L3 17l1.4-.4z'],
      sun: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 2v2', 'M12 20v2', 'M2 12h2', 'M20 12h2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M19.1 4.9l-1.4 1.4', 'M6.3 17.7l-1.4 1.4'],
      moon: ['M21 13.2A8.5 8.5 0 1 1 10.8 3 6.7 6.7 0 0 0 21 13.2z'],
      monitor: ['M4 4h16v12H4z', 'M8 20h8', 'M12 16v4'],
      sliders: ['M4 6h10', 'M18 6h2', 'M4 12h4', 'M12 12h8', 'M4 18h12', 'M20 18h0', 'M14 4v4', 'M8 10v4', 'M16 16v4'],
      logs: ['M5 4h14', 'M5 9h9', 'M5 14h14', 'M5 19h7'],
      about: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 10v6', 'M12 7h.01'],
      refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 5v6h-6'],
      play: ['M8 5l11 7-11 7z'],
      stop: ['M6 6h12v12H6z'],
      send: ['M21 3 3 10l7 3 3 7z', 'M21 3l-9 9'],
      check: ['M20 6 9 17l-5-5'],
      alert: ['M12 4 3 20h18z', 'M12 10v5', 'M12 18h.01'],
      inbox: ['M4 13h4l2 3h4l2-3h4', 'M4 13 6 5h12l2 8v6H4z'],
      search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3'],
      chevron: ['m6 9 6 6 6-6'],
      plus: ['M12 5v14', 'M5 12h14'],
      close: ['M6 6l12 12', 'M18 6 6 18'],
      copy: ['M9 9h10v12H9z', 'M5 15H3V3h12v2'],
      eye: ['M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
      eyeOff: ['M3 3l18 18', 'M10.6 10.6a3 3 0 0 0 4.2 4.2', 'M9.9 5.2A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.1 4.2', 'M6.1 6.1A17.4 17.4 0 0 0 2 12s3.5 7 10 7a10.8 10.8 0 0 0 2.1-.2'],
      link: ['M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1', 'M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1'],
      users: ['M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M22 19v-1a4 4 0 0 0-3-3.9', 'M16 3.1a4 4 0 0 1 0 7.8'],
      group: ['M4 4h16v12H8l-4 4z', 'M8 9h8', 'M8 12h5'],
      clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
      shield: ['M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z'],
      bolt: ['M13 2 4 14h6l-1 8 9-12h-6z'],
      filter: ['M3 5h18', 'M6 12h12', 'M10 19h4'],
      trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 14h10l1-14'],
      pause: ['M8 5v14', 'M16 5v14'],
      bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M10 21h4'],
      plug: ['M9 2v6', 'M15 2v6', 'M7 8h10v5a5 5 0 0 1-10 0z', 'M12 18v4'],
      brain: ['M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-1 5 3 3 0 0 0 2 5h2a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z', 'M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 1 5 3 3 0 0 1-2 5h-2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M9 9H7', 'M15 9h2', 'M9 14H7', 'M15 14h2'],
      heart: ['M12 21S3 14.5 3 8.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 9 2.5C21 14.5 12 21 12 21z'],
      book: ['M4 4h7v16H4z', 'M13 4h7v16h-7z', 'M11 4v16'],
      target: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
      chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
      memory: ['M6 4h12v16H6z', 'M9 8h6', 'M9 12h6', 'M9 16h4'],
    }

    function Icon(props) {
      const paths = ICON_PATHS[props.name] || ICON_PATHS.about
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: props.size || 18,
          height: props.size || 18,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: props.strokeWidth || 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: 'false',
        },
        paths.map((d, index) => h('path', { key: index, d })),
      )
    }

    function OneBotIcon(props) {
      return h(Icon, { name: 'message', size: (props && props.size) || 18 })
    }

    function RefreshIcon(props) {
      return h(Icon, { name: 'refresh', size: (props && props.size) || 16 })
    }

    function Btn(props) {
      const busy = Boolean(props.busy)
      const disabled = Boolean(props.disabled || busy)
      return h(
        'button',
        {
          type: props.type || 'button',
          className: cx('ob-btn', props.kind, props.small && 'small', props.large && 'large', props.block && 'block', props.className),
          disabled,
          title: props.title,
          'aria-label': props['aria-label'],
          'aria-describedby': props['aria-describedby'],
          'aria-busy': busy ? true : undefined,
          onClick: disabled ? undefined : props.onClick,
        },
        busy ? h('i', { className: 'ob-spinner ob-spin', 'aria-hidden': true }) : props.icon ? h(Icon, { name: props.icon, size: props.small ? 14 : 16 }) : null,
        props.children === undefined ? null : h('span', null, props.children),
      )
    }

    function IconBtn(props) {
      return h(
        'button',
        {
          type: 'button',
          className: cx('ob-icon-btn', props.small && 'small', props.className),
          title: props.title,
          'aria-label': props.label || props.title,
          onClick: props.onClick,
          disabled: props.disabled,
        },
        props.icon ? h(Icon, { name: props.icon, size: props.small ? 15 : 18 }) : props.children,
      )
    }

    function StatusPill(props) {
      return h(
        'span',
        { className: cx('ob-status-pill', props.tone) },
        h('i', { className: 'ob-dot', 'data-live': props.live ? 'true' : 'false', 'aria-hidden': true }),
        h('span', null, props.text),
        props.extra ? h('span', { className: 'ob-status-extra' }, props.extra) : null,
      )
    }

    function Badge(props) {
      return h('span', { className: cx('ob-badge', props.tone) }, props.children)
    }

    function SoftIcon(props) {
      const size = props.size === 'small' ? 15 : props.size === 'large' ? 21 : 17
      return h('span', { className: cx('ob-icon-tile', props.tone, props.size), 'aria-hidden': true }, h(Icon, { name: props.name, size }))
    }

    function PageHeader(props) {
      return h(
        'header',
        { className: 'ob-header' },
        h(
          'div',
          { className: 'ob-header-main' },
          props.eyebrow
            ? h('p', { className: 'ob-eyebrow' }, h('i', { className: 'ob-eyebrow-dot', 'aria-hidden': true }), props.eyebrow)
            : null,
          h('h1', { id: 'ob-page-title', tabIndex: -1, className: 'ob-display' }, props.title),
          props.description ? h('p', { className: 'ob-subtitle', title: props.description }, props.description) : null,
        ),
      )
    }

    function Panel(props) {
      const appearance = props.appearance || 'elevated'
      const hasHead = props.title || props.description || props.actions
      return h(
        'section',
        { id: props.id, className: cx('ob-panel', appearance === 'elevated' ? '' : appearance, props.className) },
        hasHead
          ? h(
              'div',
              { className: cx('ob-panel-head', props.line === false ? '' : 'with-line', props.headClassName) },
              h(
                'div',
                { className: 'ob-stack', style: { gap: '2px', minWidth: 0, flex: '1 1 220px' } },
                props.title ? h('h2', { className: 'ob-panel-title' }, props.title) : null,
                props.description ? h('p', { className: 'ob-panel-desc' }, props.description) : null,
              ),
              props.actions ? h('div', { className: 'ob-panel-actions' }, props.actions) : null,
            )
          : null,
        h('div', { className: cx('ob-panel-body', props.flush && 'flush', props.bodyClassName) }, props.children),
        props.footer ? h('div', { className: 'ob-panel-foot' }, props.footer) : null,
      )
    }

    function Section(props) {
      return h(
        'div',
        { className: cx('ob-section', props.className), id: props.id },
        props.title || props.actions
          ? h(
              'div',
              { className: 'ob-spread' },
              h(
                'div',
                { className: 'ob-stack', style: { gap: '2px', minWidth: 0 } },
                props.title ? h('h2', { className: 'ob-section-title' }, props.title) : null,
                props.description ? h('p', { className: 'ob-panel-desc' }, props.description) : null,
              ),
              props.actions ? h('div', { className: 'ob-row' }, props.actions) : null,
            )
          : null,
        props.children,
      )
    }

    function StatTile(props) {
      const motion = useMotion()
      const numeric = typeof props.value === 'number' && Number.isFinite(props.value)
      const shown = useCountUp(numeric ? props.value : 0, motion, 240)
      const display = numeric ? formatCount(shown) + (props.denominator != null ? ' / ' + formatCount(props.denominator) : '') : String(props.value == null ? '—' : props.value)
      return h(
        'div',
        { className: 'ob-stat' },
        h(
          'div',
          { className: 'ob-stat-top' },
          h('p', { className: 'ob-stat-label' }, props.label),
          props.icon ? h(SoftIcon, { name: props.icon, tone: props.tone, size: 'small' }) : null,
        ),
        h('p', { className: 'ob-stat-value', 'aria-label': props.label + '：' + display }, display),
        props.hint ? h('p', { className: 'ob-stat-hint' }, props.hint) : null,
        props.progress != null
          ? h('div', { className: 'ob-stat-bar' }, h('div', { className: 'ob-stat-bar-fill', style: { width: (clamp01(props.progress) * 100).toFixed(1) + '%' } }))
          : null,
      )
    }

    function MiniBars(props) {
      const rows = safeArray(props.rows)
      const max = rows.reduce((value, row) => Math.max(value, Number(row.value) || 0), 0) || 1
      return h(
        'div',
        { className: 'ob-bars', 'aria-label': props.label || '分布' },
        rows.map((row, index) =>
          h(
            'div',
            { className: 'ob-bar-row', key: row.label || index },
            h('span', { className: 'ob-bar-label' }, row.label),
            h('div', { className: 'ob-bar-track' }, h('div', { className: 'ob-bar-fill', style: { width: (((Number(row.value) || 0) / max) * 100).toFixed(1) + '%', background: row.color } })),
            h('span', { className: 'ob-bar-value' }, formatCount(row.value || 0)),
          ),
        ),
      )
    }

    function KV(props) {
      const rows = safeArray(props.rows)
      return h(
        'dl',
        { className: 'ob-kv' },
        rows.map((row, index) =>
          h('div', { className: 'ob-kv-row', key: (row && row[0]) || index }, h('dt', { className: 'ob-kv-k' }, row[0]), h('dd', { className: 'ob-kv-v' }, row[1])),
        ),
      )
    }

    function EmptyState(props) {
      return h(
        'div',
        { className: cx('ob-state', props.compact && 'compact'), role: props.role },
        h('span', { className: cx('ob-state-icon', props.tone), 'aria-hidden': true }, h(Icon, { name: props.icon || 'inbox', size: 22 })),
        h('h3', { className: 'ob-state-title' }, props.title || '暂无内容'),
        props.description ? h('p', { className: 'ob-state-desc' }, props.description) : null,
        props.action ? h('div', { className: 'ob-state-action' }, props.action) : null,
      )
    }

    function Skeleton(props) {
      const variant = props.variant || ''
      const style = Object.assign({}, props.style || null, props.width ? { width: props.width } : null, props.height ? { height: props.height } : null)
      return h('span', { className: cx('ob-skeleton', variant, props.className), 'aria-hidden': true, style })
    }

    function PanelSkeleton(props) {
      const rows = Math.max(1, Number(props.rows) || 3)
      return h(
        'div',
        { className: 'ob-panel' },
        h(
          'div',
          { className: 'ob-panel-body' },
          h('div', { className: 'ob-skel-stack' }, h(Skeleton, { variant: 'title', width: '36%' }), h(Skeleton, { variant: 'text', width: '72%' })),
          h(
            'div',
            { className: 'ob-skel-stack', style: { marginTop: '16px' } },
            Array.from({ length: rows }).map((_, index) => h(Skeleton, { key: index, variant: 'text', width: index % 2 ? '86%' : '100%' })),
          ),
        ),
      )
    }

    function StatSkeleton() {
      return h(
        'div',
        { className: 'ob-stat' },
        h('div', { className: 'ob-stat-top' }, h(Skeleton, { variant: 'text', width: '52%' }), h(Skeleton, { className: 'ob-skeleton', width: '30px', height: '30px', style: { borderRadius: '12px' } })),
        h(Skeleton, { variant: 'title', width: '62%', style: { marginTop: '10px' } }),
        h(Skeleton, { variant: 'text', width: '44%' }),
      )
    }

    function FieldRow(props) {
      const spec = props.spec || {}
      const id = 'ob-field-' + String(spec.path || '').replace(/[^a-zA-Z0-9_-]/g, '-')
      return h(
        'div',
        { className: 'ob-field', 'data-field': spec.path },
        h(
          'label',
          { className: 'ob-field-label', htmlFor: id },
          spec.label || spec.path,
          spec.type === 'secret' ? h(Badge, { tone: 'brand' }, '密钥') : null,
        ),
        h('div', { className: 'ob-field-control' }, h(FieldControl, { id, spec, value: props.value, onChange: props.onChange, disabled: props.disabled })),
        spec.help ? h('p', { className: 'ob-field-help' }, spec.help) : null,
      )
    }

    function FieldControl(props) {
      const spec = props.spec || {}
      const value = props.value
      const disabled = Boolean(props.disabled)
      const onChange = props.onChange || (() => {})
      const id = props.id
      if (spec.type === 'switch') {
        return h(Switch, { id, on: Boolean(value), onChange, disabled, label: spec.label })
      }
      if (spec.type === 'secret') {
        return h(SecretField, { id, spec, value, onChange, disabled })
      }
      if (spec.type === 'string-list') {
        return h(StringListField, { id, spec, value, onChange, disabled })
      }
      if (spec.type === 'number-list') {
        return h(NumberListField, { id, spec, value, onChange, disabled })
      }
      if (spec.type === 'select') {
        return h(
          'select',
          { id, className: 'ob-select', value: value == null ? '' : String(value), disabled, onChange: (event) => onChange(event.target.value) },
          safeArray(spec.options).map((option) =>
            h('option', { key: String(option.value), value: String(option.value) }, option.label == null ? String(option.value) : String(option.label)),
          ),
        )
      }
      if (spec.type === 'number') {
        return h(
          'span',
          { className: 'ob-number-control' },
          h('input', {
            id,
            className: 'ob-input',
            type: 'number',
            value: value == null ? '' : value,
            min: spec.min,
            max: spec.max,
            step: spec.step,
            placeholder: spec.placeholder,
            disabled,
            onChange: (event) => {
              const raw = event.target.value
              onChange(raw === '' ? '' : Number(raw))
            },
          }),
          spec.unit ? h('span', { className: 'ob-field-unit' }, spec.unit) : null,
        )
      }
      if (spec.type === 'textarea') {
        return h('textarea', {
          id,
          className: 'ob-textarea',
          value: value == null ? '' : String(value),
          placeholder: spec.placeholder,
          disabled,
          onChange: (event) => onChange(event.target.value),
        })
      }
      return h('input', {
        id,
        className: 'ob-input',
        type: 'text',
        value: value == null ? '' : String(value),
        placeholder: spec.placeholder,
        disabled,
        onChange: (event) => onChange(event.target.value),
      })
    }

    function SecretField(props) {
      const [shown, setShown] = useState(false)
      const spec = props.spec || {}
      return h(
        'span',
        { className: 'ob-input-wrap' },
        h('input', {
          id: props.id,
          className: 'ob-input',
          type: shown ? 'text' : 'password',
          value: props.value == null ? '' : String(props.value),
          placeholder: spec.placeholder || '留空则不修改/不启用',
          disabled: props.disabled,
          autoComplete: 'off',
          spellCheck: false,
          onChange: (event) => props.onChange(event.target.value),
        }),
        h(
          'button',
          { type: 'button', className: 'ob-secret-toggle', onClick: () => setShown((previous) => !previous), disabled: props.disabled, 'aria-label': shown ? '隐藏密钥' : '显示密钥' },
          h(Icon, { name: shown ? 'eyeOff' : 'eye', size: 14 }),
          shown ? '隐藏' : '显示',
        ),
      )
    }

    function StringListField(props) {
      const value = safeArray(props.value)
      const [draft, setDraft] = useState('')
      const commit = (raw) => {
        const text = String(raw == null ? '' : raw).trim()
        if (!text) return
        const next = value.slice()
        if (!next.includes(text)) next.push(text)
        props.onChange(next)
        setDraft('')
      }
      return h(
        'div',
        { className: 'ob-tags' },
        value.map((item) =>
          h(
            'span',
            { className: 'ob-tag', key: item },
            String(item),
            h('button', { type: 'button', disabled: props.disabled, 'aria-label': '移除 ' + item, onClick: () => props.onChange(value.filter((entry) => entry !== item)) }, '×'),
          ),
        ),
        h('input', {
          id: props.id,
          value: draft,
          placeholder: '输入后回车添加，逗号分隔可一次多个',
          disabled: props.disabled,
          onChange: (event) => {
            const raw = event.target.value
            if (/[,，]/.test(raw)) {
              raw.split(/[,，]/).forEach(commit)
            } else {
              setDraft(raw)
            }
          },
          onKeyDown: (event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit(draft)
            } else if (event.key === 'Backspace' && !draft && value.length) {
              props.onChange(value.slice(0, -1))
            }
          },
        }),
      )
    }

    function formatNumberList(value) {
      const list = safeArray(value)
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item))
      return list.join(', ')
    }

    function NumberListField(props) {
      const [draft, setDraft] = useState(() => formatNumberList(props.value))
      const focusedRef = useRef(false)
      const external = formatNumberList(props.value)
      useEffect(() => {
        if (!focusedRef.current) setDraft(external)
      }, [external])
      return h('input', {
        id: props.id,
        className: 'ob-input',
        type: 'text',
        value: draft,
        placeholder: '例如：1000, 3000, 5000',
        disabled: props.disabled,
        onFocus: () => {
          focusedRef.current = true
        },
        onChange: (event) => {
          const raw = event.target.value
          setDraft(raw)
          const list = raw
            .split(/[,，\s]+/)
            .map((item) => Number(item))
            .filter((item) => Number.isFinite(item))
          props.onChange(list)
        },
        onBlur: () => {
          focusedRef.current = false
          const formatted = formatNumberList(draft)
          setDraft(formatted)
        },
      })
    }

    function Switch(props) {
      return h('button', {
        id: props.id,
        type: 'button',
        role: 'switch',
        'aria-checked': Boolean(props.on),
        'aria-label': props.label,
        className: cx('ob-switch', props.on && 'on'),
        disabled: props.disabled,
        onClick: () => props.onChange && props.onChange(!props.on),
      })
    }

    function Seg(props) {
      const options = safeArray(props.options)
      return h(
        'div',
        { className: 'ob-seg', role: 'group', 'aria-label': props.label || '分段选择' },
        options.map((option) =>
          h(
            'button',
            {
              key: String(option.value),
              type: 'button',
              className: cx('ob-seg-btn', option.value === props.value && 'on'),
              'aria-pressed': option.value === props.value,
              onClick: () => props.onChange(option.value),
              disabled: props.disabled,
            },
            option.label,
          ),
        ),
      )
    }

    function Block(props) {
      return h('div', { className: 'ob-stack' }, props.children)
    }

    function ProgressBar(props) {
      const max = Number(props.max) || 0
      const value = Number(props.value) || 0
      const ratio = max > 0 ? clamp01(value / max) : 0
      return h(
        'div',
        {
          className: 'ob-stat-bar',
          role: 'progressbar',
          'aria-label': props.label || '进度',
          'aria-valuemin': 0,
          'aria-valuemax': max,
          'aria-valuenow': value,
        },
        h('div', { className: 'ob-stat-bar-fill', style: { width: (ratio * 100).toFixed(1) + '%', background: props.color } }),
      )
    }

    function ListItem(props) {
      return h(
        'li',
        null,
        h(
          'button',
          { type: 'button', className: cx('ob-list-item', props.selected && 'on'), onClick: props.onClick, title: props.title },
          h('span', { className: 'ob-list-avatar', 'aria-hidden': true }, props.initials || '?'),
          h('span', { className: 'ob-list-body' }, h('span', { className: 'ob-list-title' }, props.title), props.sub ? h('span', { className: 'ob-list-sub' }, props.sub) : null),
          props.trailing ? h('span', { className: 'ob-feed-meta' }, props.trailing) : null,
        ),
      )
    }

    function Kbd(props) {
      return h('span', { className: 'ob-kbd' }, props.children)
    }

    function Code(props) {
      const text = String(props.children == null ? '' : props.children)
      return h('code', { className: 'ob-code', title: text }, text)
    }

    function LinkOut(props) {
      return h('a', { className: 'ob-link', href: props.href, target: '_blank', rel: 'noreferrer noopener' }, props.children, h(Icon, { name: 'link', size: 12 }))
    }

    function nowOf(props, value) {
      const time = Number(value)
      return formatRelative(Number.isFinite(time) ? time : undefined, props && props.now)
    }

    function EventLine(props) {
      const described = describeEvent(props.event)
      const tone = described.kind === 'message' ? 'brand' : described.kind === 'notice' ? 'warn' : described.kind === 'request' ? 'info' : 'muted'
      const iconName = described.kind === 'message' ? (described.chatType === 'group' ? 'group' : 'message') : described.kind === 'notice' ? 'bell' : described.kind === 'request' ? 'users' : 'bolt'
      const raw = safeObject(props.event)
      const at = Number(raw.receivedAt) || (Number(raw.time) ? Number(raw.time) * 1000 : undefined)
      return h(
        'li',
        { className: 'ob-feed-item' },
        h(SoftIcon, { name: iconName, tone, size: 'small' }),
        h(
          'div',
          { className: 'ob-feed-body' },
          h(
            'div',
            { className: 'ob-feed-head' },
            h(Badge, { tone }, described.kindLabel),
            described.chatLabel ? h('span', { className: 'ob-feed-meta' }, described.chatLabel) : null,
            described.senderName ? h('span', { className: 'ob-feed-meta' }, described.senderName) : null,
          ),
          h('p', { className: 'ob-feed-text' }, described.summary || '（没有可展示的文本内容）'),
        ),
        h('span', { className: 'ob-feed-time' }, nowOf(props, at)),
      )
    }

    function LogLine(props) {
      const entry = normalizeLogEntry(props.entry)
      return h(
        'div',
        { className: 'ob-log-row' },
        h('span', { className: 'ob-log-time' }, entry.time),
        h('span', { className: 'ob-log-level ' + entry.level }, entry.level),
        entry.area ? h('span', { className: 'ob-log-area' }, entry.area) : null,
        h('span', { className: 'ob-log-text' }, entry.text),
      )
    }

    // =====================================================================
    // 标签栏 / 反馈（banner / toast / savebar）/ 顶部进度
    // =====================================================================

    const LEGACY_NAV_LABELS = { connect: '连接', config: '配置', cognition: '认知', settings: '系统设置', persona: '人格', messages: '消息', modules: '模块', models: '模型', about: '关于' }
    const SECTION_LABELS = {
      overview: '概览', messages: '消息与事件', sandbox: '离线 Sandbox', library: '人格库', general: '常规', persona: '人格表达',
      models: '模型', turn: '轮次与群聊参与', reply: '回复与通知', persons: '人物', relationships: '关系', memories: '记忆',
      timeline: '时间轴', emotion: '情绪', purpose: '目的', policy: '策略与决策', proactivity: '主动行为', loop: '闭环', learning: '学习',
      skills: '技能', meta: '元认知', modules: '模块目录', module: '模块详情', media: '媒体', content: '内容', logs: '日志', events: '事件', backup: '备份',
      privacy: '隐私与保留', import: '导入', connection: '连接', timeouts: '超时与验证', appearance: '外观', security: '安全', access: '访问控制',
      runtime: '运行时', diagnostics: '诊断', about: '关于',
    }
    const COMPACT_AREA_LABELS = { overview: '概览', chat: '聊天与沙盒', profiles: '人格', extensions: '扩展', data: '数据与日志', system: '系统' }
    const TABS = NAVIGATION_REGISTRY.map(area => ({ id: area.id, label: area.label, icon: 'layout' }))
    function ownerFields(target) {
      return SETTINGS_FIELDS.filter(field => field.apply !== 'read-only' && field.storage === 'config.json'
        && field.canonical.area === target.area && field.canonical.section === target.section
        && (field.canonical.moduleId || '') === (target.moduleId || ''))
    }
    function navigationSections(area) {
      return (NAVIGATION_REGISTRY.find(row => row.id === area)?.sections || [])
        .filter(section => section.id !== 'module' && !(area === 'profiles' && section.id === 'settings'))
    }
    function CommandBar({ navigation, goTo, configInfo, gateway = {}, version = '', dirty, refreshAll, refreshing }) {
      const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [selected, setSelected] = useState(0)
      const barRef = useRef(null), searchRef = useRef(null), closeRef = useRef(null), resultsRef = useRef(null)
      const restoreRef = useRef(null), paletteRouteRef = useRef(JSON.stringify(navigation))
      const labels = { ...LEGACY_NAV_LABELS, ...SECTION_LABELS }
      for (const group of buildFieldSpecs(configInfo?.groups)) { labels['group:' + group.id] = group.title; for (const field of group.fields) labels[field.path] = field.label }
      const results = query.trim() ? searchNavigation(query, labels) : navigationSearchIndex(labels).filter(row => !row.target.fieldPath)
      const active = Math.min(selected, Math.max(0, results.length - 1))
      const close = () => { setOpen(false); setQuery(''); setSelected(0) }
      const select = target => { close(); goTo(target) }
      const paletteRoute = JSON.stringify(navigation)
      useLayoutEffect(() => {
        if (paletteRouteRef.current === paletteRoute) return
        paletteRouteRef.current = paletteRoute
        // History navigation focuses the new heading; modal cleanup must not steal it.
        restoreRef.current = null
        close()
      }, [paletteRoute])
      useLayoutEffect(() => {
        const shortcut = event => {
          if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k' || !barRef.current?.getClientRects().length) return
          event.preventDefault(); event.stopPropagation()
          if (!event.repeat) { setQuery(''); setSelected(0); setOpen(value => !value) }
        }
        window.addEventListener('keydown', shortcut, true)
        return () => window.removeEventListener('keydown', shortcut, true)
      }, [])
      useLayoutEffect(() => {
        if (!open) return
        restoreRef.current = document.activeElement
        searchRef.current?.focus({ preventScroll: true })
        return () => { if (restoreRef.current?.isConnected) restoreRef.current.focus({ preventScroll: true }) }
      }, [open])
      useLayoutEffect(() => {
        if (open) resultsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
      }, [open, active, query])
      const keyDown = event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          if (results.length) setSelected((active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length)
          searchRef.current?.focus({ preventScroll: true })
        } else if (event.key === 'Enter' && event.target === searchRef.current) {
          event.preventDefault(); if (results[active]) select(results[active].target)
        } else if (event.key === 'Tab') {
          // Results use the combobox's active descendant; the two modal controls cycle.
          event.preventDefault()
          ;(event.target === searchRef.current ? closeRef : searchRef).current?.focus({ preventScroll: true })
        }
      }
      const sections = navigationSections(navigation.area)
      const isModuleDetail = navigation.area === 'extensions' && navigation.section === 'module'
      const state = stateLabel(gateway.state)
      const statusText = [state.text, gateway.login?.nickname, endpointModeLabel(gateway.endpoint?.mode), dirty ? '有未保存的改动' : ''].filter(Boolean).join(' · ')
      return h(Fragment, null,
        h('header', { ref: barRef, className: 'ob-commandbar', 'aria-label': BRAND + '命令栏' },
          h('div', { className: 'ob-commandbar-main' },
            h('div', { className: 'ob-command-brand' },
              h('strong', { title: BRAND }, BRAND),
              h('span', { className: 'ob-command-status ' + state.tone, role: 'img', 'aria-label': statusText, title: statusText }, h('i', { className: 'ob-dot', 'aria-hidden': true })),
              version ? h('span', { className: 'ob-command-version' }, 'v' + String(version)) : null),
            h('nav', { className: 'ob-area-tabs', 'aria-label': '六区导航' }, NAVIGATION_REGISTRY.map(area =>
              h('button', { key: area.id, type: 'button', className: 'ob-area-tab', 'data-area': area.id, 'aria-label': area.label,
                'aria-current': navigation.area === area.id ? 'true' : undefined,
                onClick: () => select({ area: area.id, section: navigationSections(area.id)[0].id }) }, area.label))),
            h('label', { className: 'ob-command-select' }, h('span', null, '区域'),
              h('select', { 'aria-label': '区域', value: navigation.area, onChange: event => {
                const area = event.target.value
                select({ area, section: navigationSections(area)[0].id })
              } }, NAVIGATION_REGISTRY.map(area => h('option', { key: area.id, value: area.id }, COMPACT_AREA_LABELS[area.id])))),
            h('div', { className: 'ob-command-actions' },
              h('button', { type: 'button', 'aria-label': '打开搜索', title: '搜索（Ctrl/Cmd+K）', 'aria-haspopup': 'dialog', 'aria-expanded': open, 'aria-controls': 'ob-command-palette', onClick: () => setOpen(true) }, h(Icon, { name: 'search', size: 18 })),
              h('button', { type: 'button', 'aria-label': '刷新状态', title: '刷新状态', disabled: refreshing, onClick: () => refreshAll?.() }, h(Icon, { name: 'refresh', size: 18 })))),
          isModuleDetail ? null : h('nav', { className: 'ob-sectionbar', 'aria-label': '当前区域分区' }, sections.map(section =>
            h('button', { key: section.id, type: 'button', className: 'ob-section-chip', 'data-section': navigation.area + ':' + section.id,
              'aria-current': navigation.section === section.id ? 'page' : undefined,
              onClick: () => select({ area: navigation.area, section: section.id }) }, SECTION_LABELS[section.id] || section.id))),
          !isModuleDetail && sections.length > 1 ? h('label', { className: 'ob-section-select-row' }, h('span', null, '分区'),
            h('select', { 'aria-label': '分区', value: navigation.section, onChange: event => {
              if (event.target.value !== navigation.section) select({ area: navigation.area, section: event.target.value })
            } }, sections.map(section => h('option', { key: section.id, value: section.id }, SECTION_LABELS[section.id] || section.id)))) : null),
        open ? h('div', { className: 'ob-palette-overlay', onClick: event => { if (event.target === event.currentTarget) close() } },
          h('div', { id: 'ob-command-palette', className: 'ob-palette', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'ob-palette-title', onKeyDown: keyDown },
            h('div', { className: 'ob-palette-head' }, h('h2', { id: 'ob-palette-title', className: 'ob-palette-title' }, '搜索页面与设置'),
              h('button', { ref: closeRef, type: 'button', className: 'ob-palette-close', 'aria-label': '关闭搜索', onClick: close }, h(Icon, { name: 'close', size: 18 }))),
            h('input', { ref: searchRef, type: 'search', className: 'ob-input', role: 'combobox', 'aria-label': '搜索页面、旧名称或设置路径', 'aria-expanded': true,
              'aria-autocomplete': 'list', 'aria-controls': 'ob-palette-results', 'aria-activedescendant': results.length ? 'ob-palette-result-' + active : undefined,
              value: query, onChange: event => { setQuery(event.target.value); setSelected(0) } }),
            h('div', { ref: resultsRef, id: 'ob-palette-results', className: 'ob-palette-results', role: 'listbox', 'aria-label': '搜索结果' },
              results.map((row, index) => h('button', { id: 'ob-palette-result-' + index, key: index, type: 'button', className: 'ob-palette-option', role: 'option',
                tabIndex: -1, 'aria-selected': index === active, onClick: () => select(row.target) }, row.label))),
            results.length ? null : h('p', { role: 'status' }, '没有匹配的页面或设置'))) : null)
    }

    // One partition per destination. Profile edits use explicit IDs and CAS, without activation.
    function OwnerSettings(props) {
      const fields = ownerFields(props.navigation)
      const profile = fields[0]?.ownerClass === 'profile'
      const scope = profile ? 'profile' : fields[0]?.ownerClass === 'module' ? 'module:' + props.navigation.moduleId : 'system'
      const [catalog, setCatalog] = useState([]), [id, setId] = useState(''), [view, setView] = useState(null)
      const [activeId, setActiveId] = useState('')
      const [changes, setChanges] = useState({}), [error, setError] = useState(''), [busy, setBusy] = useState(false)
      const request = useRef(0), savingGuard = useRef(false)
      useEffect(() => {
        if (!profile) return
        let alive = true
        get('/profiles').then(result => {
          if (!alive) return
          if (!result.ok) { setError(result.code || 'PROFILES_UNAVAILABLE'); return }
          setCatalog(safeArray(result.items)); setId(result.activeId || ''); setActiveId(result.activeId || '')
        }).catch(() => { if (alive) setError('PROFILES_UNAVAILABLE') })
        return () => { alive = false }
      }, [profile])
      const load = useCallback(async () => {
        const ticket = ++request.current
        setView(null); setChanges({}); setError('')
        if (profile && !id) return
        try {
          if (profile) {
            const profiles = await get('/profiles')
            if (ticket !== request.current) return
            if (!profiles.ok) { setError(profiles.code || 'PROFILES_UNAVAILABLE'); return }
            setCatalog(safeArray(profiles.items)); setActiveId(profiles.activeId || '')
          }
          const result = await get(profile ? '/profiles/config?id=' + encodeURIComponent(id) : '/settings/view?scope=' + encodeURIComponent(scope))
          if (ticket !== request.current) return
          if (!result.ok) { setError(result.code || 'SETTINGS_READ_UNAVAILABLE'); return }
          setView(result)
          if (profile && result.activeId !== undefined) setActiveId(result.activeId)
        } catch { if (ticket === request.current) setError('SETTINGS_READ_UNAVAILABLE') }
      }, [scope, id, profile])
      useEffect(() => { load(); return () => { request.current++ } }, [load, props.navigation.area, props.navigation.section])
      useEffect(() => {
        if (!view || !props.navigation.fieldPath || typeof document === 'undefined') return
        document.getElementById('ob-setting-' + props.navigation.fieldPath)?.scrollIntoView?.({ block: 'center' })
      }, [props.navigation, view])
      const save = async () => {
        if (!view || savingGuard.current || !Object.keys(changes).length) return
        savingGuard.current = true; setBusy(true); setError('')
        const ticket = request.current
        try {
          const result = await post(profile ? '/profiles/config/save' : '/settings/patch', { ...(profile ? { id } : { scope }), revision: view.revision, patch: changes })
          if (ticket !== request.current) return
          if (!result.ok) { setError(result.code || 'SETTINGS_WRITE_UNAVAILABLE'); return }
          setView(result); setChanges({})
          if (profile && result.activeId !== undefined) setActiveId(result.activeId)
          props.toast?.(profile ? (id === (result.activeId ?? activeId) ? '已保存并应用；后续轮次使用新设置' : '已保存；激活该人格后使用新设置') : '设置已保存', 'ok')
          props.refreshAll?.()
        } catch { if (ticket === request.current) setError('SETTINGS_WRITE_UNAVAILABLE') }
        finally { savingGuard.current = false; setBusy(false) }
      }
      if (!fields.length) return null
      return h('section', { className: 'ob-stack ob-owner-settings', 'aria-label': '所有者设置' },
        profile ? h(Banner, { tone: view?.runtimeMode === 'legacy' || error === 'SETTINGS_MIGRATION_UNAVAILABLE' ? 'warn' : view ? 'ok' : undefined, message: view?.runtimeMode === 'legacy' || error === 'SETTINGS_MIGRATION_UNAVAILABLE' ? 'Profile 不可用：运行已回退旧配置，请重新读取或检查迁移错误。' : !view ? (error ? 'Profile 设置读取失败，请重新读取。' : '正在读取 Profile 设置与运行状态…') : 'Profile 运行已启用：保存当前激活人格会应用于后续轮次；编辑其他人格不会激活它。业务数据与操作属于当前激活人格。' }) : null,
        profile ? h('label', null, '设置人格 ', h('select', { className: 'ob-select', 'aria-label': '设置人格', value: id, disabled: busy,
          onChange: event => { request.current++; setView(null); setChanges({}); setId(event.target.value) } }, catalog.map(item => h('option', { key: item.id, value: item.id }, item.displayName || item.name || item.id)))) : null,
        error ? h(Banner, { tone: 'err', message: error + '；重新读取会丢弃草稿。' }) : null,
        !view ? h(PanelSkeleton, { rows: 3 }) : h(Panel, { title: SECTION_LABELS[props.navigation.section] || '设置', description: profile ? (id === activeId ? '已应用 · ' : '激活后应用 · ') + 'revision ' + view.revision : '按所有者保存' },
            fields.map(field => {
              const spec = fieldSpecByPath(props.configInfo?.groups, field.path) || { path: field.path, label: field.path, type: Array.isArray(view.values[field.path]) ? 'string-list' : typeof view.values[field.path] === 'number' ? 'number' : typeof view.values[field.path] === 'boolean' ? 'switch' : 'text' }
              const secret = ['secret', 'secret-reference'].includes(field.sensitivity)
              const value = Object.hasOwn(changes, field.path) ? changes[field.path] : view.values[field.path]
              return h('div', { key: field.path, id: 'ob-setting-' + field.path, 'data-setting-path': field.path },
                secret ? h('div', { className: 'ob-stack' }, h('label', null, spec.label || field.path, h('input', { className: 'ob-input', type: 'password', autoComplete: 'new-password',
                  'aria-label': field.path, value: value?.op === 'set' ? value.value : '', placeholder: view.values[field.path]?.present ? '已设置（留空保留）' : '未设置', disabled: busy,
                  onChange: event => setChanges(previous => ({ ...previous, [field.path]: event.target.value ? { op: 'set', value: event.target.value } : { op: 'keep' } })) })),
                  h(Btn, { disabled: busy, onClick: () => setChanges(previous => ({ ...previous, [field.path]: { op: 'clear' } })) }, '清除 ' + field.path), value?.op === 'clear' ? h('span', null, '保存后清除') : null)
                  : h(FieldRow, { spec, value, disabled: busy, onChange: next => setChanges(previous => ({ ...previous, [field.path]: next })) }),
                h('small', { className: 'ob-muted' }, field.path + ' · ' + field.apply))
            })),
        h('div', { className: 'ob-owner-savebar', role: 'group', 'aria-label': '所有者设置保存工具栏' },
          h(Btn, { onClick: save, disabled: !view || busy || !Object.keys(changes).length || view.editingAvailable === false && profile }, '保存设置'),
          h(Btn, { onClick: load, disabled: busy }, '重新读取')))
    }

    function ProfileOverview(props) {
      const overview = useCognitionOverview(props)
      return h(CogOverview, { ...props, data: overview.data || {}, error: overview.error, loading: overview.loading, reload: overview.reload })
    }
    function navigationFieldId(navigation) {
      const field = SETTINGS_FIELDS.find(field => field.path === navigation.fieldPath)
      const path = field?.storage === 'module-file' && field.canonical.moduleId === navigation.moduleId
        ? field.path.slice(('modules.' + navigation.moduleId + '.').length) : navigation.fieldPath
      return 'ob-field-' + path.replace(/[^a-zA-Z0-9_-]/g, '-')
    }
    function SandboxChat() {
      const [items, setItems] = useState([])
      const [id, setId] = useState('')
      const [data, setData] = useState(null)
      const [chatType, setChatType] = useState('private')
      const [kind, setKind] = useState('message')
      const [text, setText] = useState('')
      const [ms, setMs] = useState('12000')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const sequence = useRef(0)
      const guard = useRef(false)
      const requestId = () => 'ui_' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '_' + Math.random().toString(36).slice(2))
      const checked = (response, list = false) => {
        if (!response || response.ok !== true) throw new Error(response?.code || 'SIMULATION_UNAVAILABLE')
        if (response.environment !== 'simulation' || response.realSends !== 0 || (list ? !Array.isArray(response.items)
          : !['transcript', 'captures', 'receipts', 'deliveryReceipts', 'loops', 'stages'].every(key => Array.isArray(response[key])))) throw new Error('SIMULATION_RESPONSE_INVALID')
        return response
      }
      const run = async work => {
        if (guard.current) return
        guard.current = true
        const ticket = ++sequence.current
        setBusy(true); setError('')
        try {
          const apply = await work()
          if (ticket === sequence.current) apply()
        } catch (cause) {
          if (ticket === sequence.current) {
            const code = String(cause?.message || 'SIMULATION_UNAVAILABLE')
            setError(code)
            if (code === 'SIMULATION_NOT_FOUND') { setData(null); setId(''); setItems([]) }
          }
        } finally {
          if (ticket === sequence.current) { guard.current = false; setBusy(false) }
        }
      }
      const refresh = () => run(async () => {
        const list = checked(await get('/sandbox/chat/list'), true)
        const selected = list.items.some(row => row.id === id) ? id : ''
        const next = selected ? checked(await get('/sandbox/chat/detail?id=' + encodeURIComponent(selected))) : null
        return () => { setItems(list.items); setId(selected); setData(next) }
      })
      useEffect(() => { refresh(); return () => { sequence.current++; guard.current = false } }, [])
      const select = next => {
        if (guard.current) return
        setData(null); setId(next)
        if (!next) return
        return run(async () => {
          const result = checked(await get('/sandbox/chat/detail?id=' + encodeURIComponent(next)))
          return () => setData(result)
        })
      }
      const mutate = (action, payload = {}) => run(async () => {
        const result = checked(await post('/sandbox/chat/' + action, { requestId: requestId(), ...(action === 'create' ? {} : { id }), ...payload }))
        return () => {
          if (action === 'delete') { setItems(previous => previous.filter(row => row.id !== id)); setId(''); setData(null) }
          else {
            setData(result); setId(result.id)
            if (action === 'create') setItems(previous => [...previous, { id: result.id }])
            if (action === 'event') setText('')
          }
        }
      })
      const sendEvent = () => {
        if (!id || !data || busy) return
        if (kind === 'message' && (!text.trim() || text.length > 4000)) { setError('INVALID_SIMULATION_INPUT'); return }
        const event = { kind, chatType, ...(kind === 'message' ? { text, addressed: chatType === 'group' }
          : { type: kind === 'notice' ? (chatType === 'group' ? 'group_increase' : 'friend_add') : (chatType === 'group' ? 'group' : 'friend') }) }
        return mutate('event', { event })
      }
      const advance = () => {
        const value = Number(ms)
        if (!ms.trim() || !Number.isSafeInteger(value) || value < 0 || value > 86400000) { setError('INVALID_ADVANCE'); return }
        return mutate('advance', { ms: value })
      }
      const records = (label, rows) => h('section', { className: 'ob-stack', 'aria-label': label }, h('h3', null, label),
        rows.length ? rows.map((row, index) => h('details', { key: row.id || index },
          h('summary', null, String(row.action || row.requestId || row.loopId || row.status || row.id || index + 1)),
          h('pre', { className: 'ob-sandbox-json' }, JSON.stringify(row, null, 2))))
          : h('p', { role: 'status', 'data-state': 'empty', className: 'ob-muted' }, '暂无' + label))
      const locked = busy || !id || !data
      return h('section', { className: 'ob-stack ob-sandbox', 'aria-label': '离线 Chat 沙盒', 'aria-busy': busy, 'data-environment': 'simulation' },
        h(Panel, { title: 'Chat & Sandbox', description: '固定合成参与者与 fixture 回复；事件、命令和虚拟计时仅作用于本模拟。' },
          h('strong', { className: 'ob-sandbox-badge', role: 'status' }, 'SIMULATION / zero real sends'),
          h('p', { className: 'ob-muted' }, '人格绑定由服务端确定。模拟人格与配置快照只读；命令可改变模拟内部状态。媒体、真实模型、网络和执行沙箱均未接入。'),
          h('div', { className: 'ob-row ob-wrap' },
            h(Btn, { onClick: () => mutate('create'), disabled: busy }, '创建模拟'),
            h('select', { className: 'ob-select', 'aria-label': '选择模拟', value: id, disabled: busy, onChange: event => select(event.target.value) },
              h('option', { value: '' }, '选择当前人格的模拟'), items.map(row => h('option', { key: row.id, value: row.id }, row.id))),
            h(Btn, { onClick: refresh, disabled: busy }, '刷新模拟'),
            h(Btn, { onClick: () => mutate('reset'), disabled: locked }, '重置模拟'),
            h(Btn, { onClick: () => mutate('delete'), kind: 'danger', disabled: locked }, '删除模拟'))),
        busy ? h('p', { role: 'status', 'data-state': 'loading' }, '正在处理模拟…') : null,
        error ? h('div', { role: 'alert', 'data-state': 'error' }, '模拟操作失败：' + error, h(Btn, { onClick: refresh, disabled: busy }, '重新读取模拟')) : null,
        !data ? h('p', { role: 'status', 'data-state': 'empty' }, items.length ? '请选择一个模拟。' : '暂无模拟，创建后可离线发送文本或命令。') : h(Fragment, null,
          h(Panel, { title: '模拟事件', description: '虚拟时间：' + formatDateTime(data.now) + ' · generation ' + data.generation },
            h('div', { className: 'ob-row ob-wrap' },
              h('label', null, '会话 ', h('select', { className: 'ob-select', 'aria-label': '模拟会话类型', value: chatType, disabled: locked, onChange: event => setChatType(event.target.value) }, h('option', { value: 'private' }, '私聊'), h('option', { value: 'group' }, '群聊（模拟 @）'))),
              h('label', null, '事件 ', h('select', { className: 'ob-select', 'aria-label': '模拟事件类型', value: kind, disabled: locked, onChange: event => setKind(event.target.value) }, h('option', { value: 'message' }, '文本 / 命令'), h('option', { value: 'notice' }, '好友 / 入群通知'), h('option', { value: 'request' }, '好友 / 加群请求')))),
            kind === 'message' ? h('textarea', { className: 'ob-input', 'aria-label': '模拟文本或命令', placeholder: '你好，或 /help、/like、/remind 60 离线提醒', rows: 3, maxLength: 4000, value: text, disabled: locked, onChange: event => setText(event.target.value) }) : null,
            h(Btn, { onClick: sendEvent, disabled: locked || kind === 'message' && !text.trim() }, '提交模拟事件'),
            h('div', { className: 'ob-row ob-wrap' }, h('label', null, '推进毫秒 ', h('input', { className: 'ob-input', 'aria-label': '推进虚拟时间（毫秒）', type: 'number', min: 0, max: 86400000, step: 1, value: ms, disabled: locked, onChange: event => setMs(event.target.value) })), h(Btn, { onClick: advance, disabled: locked }, '推进虚拟时间')),
            h('p', { className: 'ob-muted' }, '文本聚合与提醒等待虚拟时钟，默认推进 12 秒；单次最多一天。')),
          h(Panel, { title: '模拟 Transcript' },
            data.transcript.length ? h('ol', { className: 'ob-sandbox-transcript' }, data.transcript.map((row, index) => h('li', { key: index },
              h('small', { className: 'ob-muted' }, formatTime(row.at) + ' · ' + row.chatType + ' · ' + (row.direction === 'in' ? '输入' : '捕获输出')),
              h('p', null, row.text || row.type || row.kind)))) : h('p', { role: 'status', 'data-state': 'empty' }, '暂无模拟消息。')),
          h('div', { className: 'ob-sandbox-grid' },
            h(Panel, { title: '捕获动作' }, records('Captured actions', data.captures)),
            h(Panel, { title: 'Receipt / Loop' }, h('p', { className: 'ob-muted' }, 'sent / parts 仅为模拟 executor 结果，真实发送数始终为 0。'),
              records('入站回执', data.receipts), records('交付回执', data.deliveryReceipts), records('闭环', data.loops), records('阶段', data.stages))),
          h(Panel, { title: '人格 / 配置快照（只读）' }, h('p', null, '绑定人格：' + data.boundPersonaId),
            h('pre', { className: 'ob-sandbox-json' }, JSON.stringify({ persona: data.persona, config: data.configSnapshot }, null, 2)))))
    }

    function AreaContent(props) {
      useNavigationAnchor(props, '')
      useEffect(() => {
        if (!props.navigation?.fieldPath || typeof document === 'undefined') return
        const timer = setTimeout(() => document.getElementById(navigationFieldId(props.navigation))?.scrollIntoView?.({ block: 'center' }), 0)
        return () => clearTimeout(timer)
      }, [props.navigation, props.configInfo])
      const { area, section } = props.navigation
      let Component = null
      if (area === 'overview') Component = Overview
      else if (area === 'chat') {
        if (section === 'sandbox') return h(SandboxChat, props)
        Component = Messages
      } else if (area === 'extensions') Component = ModulesPage
      else if (area === 'data') Component = { media: MediaPage, content: ContentPage, logs: Logs, events: Messages, backup: BackupPage }[section]
      else if (area === 'system') Component = { connection: Connect, appearance: SettingsTab, security: SecurityPage, models: ModelTab, about: About }[section]
      else if (area === 'profiles') Component = { overview: ProfileOverview, library: PersonaTab, persons: CogPersons, relationships: CogRelationships, memories: CogMemories, timeline: CogTimeline,
        emotion: CogEmotion, purpose: CogPurpose, policy: CogPolicy, proactivity: CogProactivity, loop: CogLoop, learning: CogLearning, skills: CogSkills, meta: CogMeta }[section]
      if (area === 'profiles' && section === 'settings') return h(Panel, { title: 'Profile 设置目录' }, NAVIGATION_REGISTRY.find(row => row.id === 'profiles').sections.filter(row => ownerFields({ area, section: row.id }).length).map(row =>
        h(Btn, { key: row.id, onClick: () => props.goTo({ area, section: row.id }) }, SECTION_LABELS[row.id])))
      return h('div', { className: 'ob-stack' },
        area === 'profiles' ? h(Banner, { tone: 'info', message: '业务数据和操作属于当前激活人格；预览人格选择不会切换运行。' }) : null,
        Component ? h(Component, { ...props, ownerIntegration: true, operationsOnly: true }) : null,
        area === 'system' && section === 'models' ? h(CogBudgetCard, props) : null,
        area !== 'extensions' && !(area === 'system' && section === 'appearance') && ownerFields(props.navigation).length ? h(OwnerSettings, { ...props, key: area + ':' + section }) : null)
    }

    function Tabs(props) {
      const motion = useMotion()
      const tabs = safeArray(props.tabs)
      const current = props.current
      const { listRef, indicator } = useTabIndicator(current, motion, [tabs.length, props.dirty])

      const activate = (id, focus) => {
        props.onChange(id)
        if (!focus) return
        try {
          const list = listRef.current
          const button = list && list.querySelector('[data-tab-id="' + id + '"]')
          if (button && button.focus) button.focus()
        } catch (error) {}
      }

      const onKeyDown = (event) => {
        const index = tabs.findIndex((tab) => tab.id === current)
        let next = -1
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
        else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = tabs.length - 1
        if (next < 0) return
        event.preventDefault()
        activate(tabs[next].id, true)
      }

      return h(
        'nav',
        { className: 'ob-tabs', 'aria-label': `${BRAND} 面板` },
        h(
          'div',
          { className: 'ob-tablist', role: 'tablist', ref: listRef, onKeyDown },
          h('span', { className: 'ob-tab-pill', 'aria-hidden': true, style: indicator }),
          tabs.map((tab) =>
            h(
              'button',
              {
                key: tab.id,
                type: 'button',
                role: 'tab',
                id: 'ob-tab-' + tab.id,
                'data-tab-id': tab.id,
                'aria-selected': current === tab.id,
                'aria-controls': 'ob-panel-' + tab.id,
                tabIndex: current === tab.id ? 0 : -1,
                className: cx('ob-tab', current === tab.id && 'on'),
                onClick: () => activate(tab.id, false),
              },
              h(Icon, { name: tab.icon, size: 15 }),
              h('span', null, tab.label),
              props.dirty && tab.id === 'config' ? h('i', { className: 'ob-tab-dirty', title: '有未保存的改动', 'aria-label': '有未保存的改动' }) : null,
            ),
          ),
        ),
      )
    }

    function Banner(props) {
      const tone = props.tone || 'warn'
      const iconName = props.icon || (tone === 'ok' ? 'check' : tone === 'err' ? 'alert' : tone === 'warn' ? 'alert' : 'about')
      const iconTone = tone === 'ok' ? 'ok' : tone === 'err' ? 'err' : tone === 'warn' ? 'warn' : 'info'
      return h(
        Presence,
        { visible: props.visible !== false, className: cx('ob-banner', tone) },
        h(SoftIcon, { name: iconName, tone: iconTone, size: 'small' }),
        h('span', { className: 'ob-banner-msg' }, props.message),
        props.actions ? h('span', { className: 'ob-banner-actions' }, props.actions) : null,
      )
    }

    function Toast(props) {
      const message = props.message
      const tone = message && message.kind ? message.kind : 'info'
      const mark = tone === 'ok' ? '✓' : tone === 'err' ? '!' : 'i'
      return h(
        Presence,
        { key: (message && message.uid) || 'toast', visible: Boolean(message), className: cx('ob-toast', tone), role: 'status', 'aria-live': 'polite' },
        h('span', { className: 'ob-toast-mark', 'aria-hidden': true }, mark),
        h('span', null, message ? message.text : ''),
      )
    }

    function Savebar(props) {
      return h(
        Presence,
        { visible: Boolean(props.visible), className: 'ob-savebar' },
        h('span', { className: 'ob-savebar-msg' }, h(Icon, { name: 'alert', size: 15 }), '有未保存的配置改动'),
        h(
          'span',
          { className: 'ob-savebar-actions' },
          h('span', { className: 'ob-small ob-muted' }, h(Kbd, null, 'Ctrl'), ' + ', h(Kbd, null, 'S')),
          h(Btn, { small: true, kind: 'ghost', onClick: props.onUndo, disabled: props.saving }, '撤销'),
          h(Btn, { small: true, kind: 'primary', onClick: props.onSave, busy: props.saving }, props.saving ? '保存中…' : '保存'),
        ),
      )
    }

    function TopProgress(props) {
      const phase = props.phase || 'idle'
      return h(
        'div',
        { className: 'ob-progress', 'data-phase': phase, 'aria-hidden': 'true' },
        h('div', { className: 'ob-progress-track' }),
        h('div', { className: 'ob-progress-fill' }),
      )
    }

    // =====================================================================
    // 标签页：概览（状态 hero / 统计 / 分布 / 最近事件 / 快捷操作）
    // =====================================================================

    function Overview(props) {
      const motion = useMotion()
      const status = props.status
      const gateway = safeObject(status && status.gateway)
      const events = safeObject(status && status.events)
      const logs = safeObject(status && status.logs)
      const config = safeObject(props.configInfo && props.configInfo.config)
      const cognition = useCognitionOverview(props)
      const cogData = safeObject(cognition.data)
      const cogPersona = safeObject(cogData.persona)
      const cogPipeline = safeObject(cogData.pipeline)
      const cogTurn = safeObject(cogData.config && cogData.config.turn)
      const state = stateLabel(gateway.state)
      const check = loginCheckLabel(gateway.loginCheck)
      const login = isPlainObject(gateway.login) ? gateway.login : null
      const byKind = safeObject(events.byKind)
      const byChat = safeObject(events.byChat)
      const recent = safeArray(status && status.recentEvents)
      const access = safeObject(status && status.access)
      const accessCounters = safeObject(access.counters)
      const runtimeInfo = safeObject(status && status.runtime)
      const now = props.now || Date.now()
      const [busy, setBusy] = useState('')
      const connected = gateway.state === 'connected'
      const connecting = gateway.state === 'connecting'
      const paused = gateway.state === 'paused'
      const configured = Boolean(gateway.configured)
      const live = connected || connecting
      const buffered = Number(events.buffered) || 0
      const capacity = Number(events.capacity) || 0
      const stateTone = state.tone === 'ok' ? 'ok' : state.tone === 'err' ? 'err' : state.tone === 'warn' ? 'warn' : 'muted'
      const ringTone = connected ? 'ok' : connecting ? 'brand' : paused ? 'err' : configured ? 'warn' : 'muted'
      const ringIcon = connected ? 'check' : connecting ? 'refresh' : paused ? 'pause' : 'plug'

      const act = async (name, label) => {
        setBusy(name)
        try {
          await props.gatewayAction(name, label)
        } finally {
          setBusy('')
        }
      }

      const heroTitle = connected ? 'QQ 网关已连接' : connecting ? '正在连接 QQ 网关…' : paused ? '连接已暂停' : configured ? '连接已停止' : '还没有配置 QQ 网关'
      let heroDesc = '在下方「连接」页填写 WebSocket / HTTP 地址并保存后即可连接。'
      if (connected) {
        heroDesc = login && login.userId
          ? '登录账号 ' + String(login.nickname || '') + '（' + String(login.userId) + '）' + (gateway.loginCheck === 'ok' ? '，账号核验通过。' : '。')
          : '网关已连接；登录账号信息稍后会显示在这里。'
      } else if (connecting) {
        heroDesc = '正在建立 WebSocket 连接并核验登录账号，请稍候…'
      } else if (paused) {
        heroDesc = '登录账号与配置不一致，自动重连已暂停。确认机器人 QQ 号或网关登录账号后重新连接。'
      } else if (configured) {
        heroDesc = '地址已配置。点「连接」开始接收 QQ 事件。'
      }

      const actionButtons = []
      if (connected || connecting) {
        actionButtons.push(h(Btn, { key: 'disc', kind: 'ghost', icon: 'stop', onClick: () => act('disconnect', '断开'), busy: busy === 'disconnect' }, '断开'))
      } else {
        actionButtons.push(h(Btn, { key: 'conn', kind: 'primary', icon: 'play', onClick: () => act('connect', '连接'), busy: busy === 'connect' }, '连接'))
      }
      actionButtons.push(h(Btn, { key: 'rec', icon: 'refresh', onClick: () => act('reconnect', '重连'), busy: busy === 'reconnect' }, '重连'))

      return h(
        'div',
        { className: 'ob-page' },
        !configured
          ? h(Banner, {
              tone: 'warn',
              icon: 'plug',
              message: '还没有可用的 OneBot 地址：去「连接」填写 WebSocket / HTTP 地址并保存，然后点「连接」。',
              actions: [h(Btn, { key: 'go', small: true, kind: 'secondary', onClick: () => props.go('connect') }, '去连接')],
            })
          : null,
        paused
          ? h(Banner, {
              tone: 'err',
              message: '登录账号与配置不一致，自动重连已暂停。确认机器人 QQ 号或网关登录的账号后重新连接。',
              actions: [h(Btn, { key: 'go', small: true, kind: 'secondary', onClick: () => props.go('connect') }, '去处理')],
            })
          : null,
        gateway.lastError && !paused
          ? h(Banner, {
              tone: 'err',
              message: '最近错误：' + String(gateway.lastError),
            })
          : null,

        h(
          Reveal,
          { as: 'section', className: 'ob-panel brand' },
          h(
            'div',
            { className: 'ob-panel-body' },
            h(
              'div',
              { className: 'ob-hero' },
              h(
                'div',
                { className: 'ob-hero-main' },
                h('span', { className: 'ob-ring ' + ringTone }, h(Icon, { name: ringIcon, size: 26 })),
                h(
                  'div',
                  { className: 'ob-hero-copy' },
                  h('div', { className: 'ob-hero-title' }, heroTitle, live ? h('i', { className: 'ob-dot', 'data-live': 'true', 'aria-hidden': true }) : null),
                  h('p', { className: 'ob-hero-sub' }, heroDesc),
                ),
                h('div', { className: 'ob-hero-actions' }, actionButtons),
              ),
              h(
                'div',
                { className: 'ob-hero-facts' },
                h('div', null, h('p', { className: 'ob-fact-k' }, '网关模式'), h('p', { className: 'ob-fact-v' }, endpointModeLabel(gateway.endpoint && gateway.endpoint.mode))),
                h('div', null, h('p', { className: 'ob-fact-k' }, '期望账号'), h('p', { className: 'ob-fact-v' }, gateway.expectedBotQQ || config.botQQ || '未填写')),
                h('div', null, h('p', { className: 'ob-fact-k' }, '核验结果'), h('p', { className: 'ob-fact-v' }, h(Badge, { tone: check.tone === 'ok' ? 'ok' : check.tone === 'err' ? 'err' : 'warn' }, check.text))),
                h('div', null, h('p', { className: 'ob-fact-k' }, '连接时长'), h('p', { className: 'ob-fact-v' }, gateway.connectedAt && connected ? formatDuration(now - Number(gateway.connectedAt)) : gateway.connectedAt ? formatRelative(Number(gateway.connectedAt), now) : '—')),
                h('div', null, h('p', { className: 'ob-fact-k' }, '重连次数'), h('p', { className: 'ob-fact-v' }, gateway.reconnects == null ? '—' : String(gateway.reconnects))),
                h('div', null, h('p', { className: 'ob-fact-k' }, '登录尝试'), h('p', { className: 'ob-fact-v' }, gateway.loginAttempts == null ? '—' : String(gateway.loginAttempts))),
                h('div', null, h('p', { className: 'ob-fact-k' }, '上次断开'), h('p', { className: 'ob-fact-v' }, gateway.lastDisconnectAt ? formatRelative(Number(gateway.lastDisconnectAt), now) : '—')),
              ),
            ),
          ),
        ),

        h(
          Reveal,
          { className: 'ob-stat-grid' },
          h(StatTile, { label: '收到事件', value: Number(events.received) || 0, icon: 'inbox', tone: 'brand', hint: '自插件启动以来' }),
          h(StatTile, { label: '已接受', value: Number(events.accepted) || 0, icon: 'check', tone: 'ok', hint: '通过过滤规则' }),
          h(StatTile, { label: '已丢弃', value: Number(events.dropped) || 0, icon: 'filter', tone: 'warn', hint: '被过滤或无效事件' }),
          h(StatTile, { label: '事件缓冲', value: buffered, denominator: capacity, icon: 'bolt', tone: 'info', hint: '环形缓冲上限 ' + (capacity || '—'), progress: capacity ? buffered / capacity : 0 }),
          h(StatTile, { label: '日志总数', value: Number(logs.total) || 0, icon: 'logs', tone: 'muted', hint: '当前缓冲 ' + (Number(logs.buffered) || 0) + ' 条' }),
        ),

        h(
          Reveal,
          null,
          h(
            Panel,
            {
              title: '访问控制',
              description: access.configured ? 'allowlist：只有主人与白名单能触发回复/主动行为。' : 'open：任何私聊/群都能触发回复，保持现有行为。',
              actions: h(Btn, { small: true, kind: 'ghost', icon: 'security', onClick: () => props.go('config') }, '去配置'),
            },
            h('div', { className: 'ob-row', style: { marginBottom: '8px', flexWrap: 'wrap' } },
              h(Badge, { tone: access.configured ? 'ok' : 'warn' }, access.configured ? 'allowlist' : 'open'),
              h(Badge, { tone: 'muted' }, '主人：' + (access.ownerQQ ? (access.ownerName || '主人') + ' · ' + access.ownerQQ : '未填写')),
              h(Badge, { tone: 'muted' }, '私聊白名单 ' + String(Number(safeObject(access.allow).private) || 0)),
              h(Badge, { tone: 'muted' }, '群白名单 ' + String(Number(safeObject(access.allow).groups) || 0)),
              h(Badge, { tone: Number(accessCounters.inboundBlocked) ? 'warn' : 'muted' }, '入站拦截 ' + String(Number(accessCounters.inboundBlocked) || 0)),
              h(Badge, { tone: Number(accessCounters.outboundBlocked) ? 'warn' : 'muted' }, '出站拦截 ' + String(Number(accessCounters.outboundBlocked) || 0)),
            ),
            h('p', { className: 'ob-field-help', style: { margin: 0 } },
              access.configured
                ? '被拒绝的消息不落 raw、不聚合、不回复；审计只存会话/发送者/原因/时间，不存正文。'
                : '建议在「配置 → 访问控制」切换到 allowlist 并填写主人 QQ；默认 open 是为了升级后行为不变。'),
          ),
        ),

        h(
          Reveal,
          { className: 'ob-grid two' },
          h(
            Panel,
            {
              title: '人格',
              description: '固定人设、说话风格与边界；可保存多份并切换。',
              actions: h(Btn, { small: true, kind: 'ghost', icon: 'sparkles', onClick: () => props.go('persona') }, '人格库'),
            },
            cogPersona.profile && cogPersona.profile.displayName
              ? h('div', { className: 'ob-stack', style: { gap: '8px' } },
                  h('div', { className: 'ob-row' },
                    h(Badge, { tone: 'brand' }, cogPersona.profile.displayName),
                    cogPersona.profile.tagline ? h('span', { className: 'ob-muted' }, cogPersona.profile.tagline) : null,
                    h(Badge, { tone: 'muted' }, 'v' + String(cogPersona.version || 1)),
                    h(Badge, { tone: 'muted' }, String(Number(cogPersona.personaCount) || 1) + ' 份人格'),
                  ),
                  h('p', { className: 'ob-field-help' }, cogPersona.profile.personality || cogPersona.profile.speakingStyle || '还没有填写文本人设；点击「编辑人格」开始。'),
                )
              : h('div', { className: 'ob-stack', style: { gap: '6px' } },
                  h('p', { className: 'ob-muted' }, '还没有可读的文本人设；数值人格已存在，但用户看不到。'),
                  h(Btn, { small: true, kind: 'secondary', onClick: () => props.go('persona') }, '去填写人格'),
                ),
          ),
          h(
            Panel,
            {
              title: '运行诊断',
              description: '最近一条消息为什么回复/沉默/跳过；群聊 gate 的实时状态。',
              actions: h(Btn, { small: true, kind: 'ghost', icon: 'brain', onClick: () => props.go('cognition') }, '查看认知'),
            },
            h('div', { className: 'ob-diagnostic-row', style: { marginBottom: '8px' } },
              h(Badge, { tone: 'info' }, '群聊：' + (cogPipeline.groupMode === 'all' ? '所有消息' : cogPipeline.groupMode === 'probability' ? '按概率参与' : '仅 @/唤醒词')),
              h(Badge, { tone: Number(cogPipeline.groupSkipped) ? 'warn' : 'muted' }, '跳过 ' + String(Number(cogPipeline.groupSkipped) || 0)),
              h(Badge, { tone: runtimeInfo.active ? 'ok' : 'muted' }, '运行时：' + (runtimeInfo.active ? 'agent' : 'oneshot') + (runtimeInfo.available ? '' : ' / 不可用')),
              h(Badge, { tone: 'muted' }, '会话 ' + String(Number(runtimeInfo.sessions) || 0)),
            ),
            cogPipeline.lastTurn
              ? h('div', { className: 'ob-stack', style: { gap: '4px' } },
                  h('p', { className: 'ob-feed-meta', style: { margin: 0 } },
                    '最近：' + (cogPipeline.lastTurn.chatType === 'group' ? '群聊' : '私聊') +
                    (cogPipeline.lastTurn.addressed ? '（点名）' : '（未点名）') +
                    ' → ' + String(cogPipeline.lastTurn.outcome || '—') + (cogPipeline.lastTurn.reason ? ' · ' + String(cogPipeline.lastTurn.reason) : ''),
                  ),
                  h('p', { className: 'ob-field-help', style: { margin: 0 } },
                    cogPipeline.lastTurn.outcome === 'skipped'
                      ? '这条消息被群聊规则跳过；可在「人格 → 群聊参与」里改为概率或所有消息。'
                      : '最近一条消息已进入认知流程；若没有回复，可能是策略选择沉默。',
                  ),
                )
              : h('p', { className: 'ob-muted' }, '还没有认知事件；连接后发一条消息试试。'),
          ),
        ),

        h(
          Reveal,
          { className: 'ob-grid two' },
          h(
            Panel,
            { title: '事件类型分布', description: '按 OneBot 事件大类统计；只统计已接受的事件。' },
            h(MiniBars, {
              label: '事件类型分布',
              rows: EVENT_KINDS.map((kind, index) => ({ label: eventKindLabel(kind), value: Number(byKind[kind]) || 0, color: 'var(--ob-chart-' + ((index % 5) + 1) + ')' })),
            }),
          ),
          h(
            Panel,
            {
              title: '会话分布',
              description: '私聊 / 群聊 / 其它，以及最近一条事件时间。',
              actions: h(Btn, { small: true, kind: 'ghost', onClick: () => props.go('messages') }, '去消息页'),
            },
            h(MiniBars, {
              label: '会话分布',
              rows: [
                { label: '私聊', value: Number(byChat.private) || 0, color: 'var(--ob-chart-1)' },
                { label: '群聊', value: Number(byChat.group) || 0, color: 'var(--ob-chart-2)' },
                { label: '其它', value: Number(byChat.other) || 0, color: 'var(--ob-chart-4)' },
              ],
            }),
            h('p', { className: 'ob-feed-meta', style: { marginBottom: 0, marginTop: '14px' } }, '最后事件：' + (events.lastAt ? formatRelative(Number(events.lastAt), now) : '—')),
          ),
        ),

        h(
          Reveal,
          { as: 'section', className: 'ob-panel' },
          h(
            'div',
            { className: 'ob-panel-head with-line' },
            h('div', { className: 'ob-stack', style: { gap: '2px' } }, h('h2', { className: 'ob-panel-title' }, '最近事件'), h('p', { className: 'ob-panel-desc' }, '最新 8 条规范化事件；完整事件流在「消息」页。')),
            h('div', { className: 'ob-panel-actions' }, h(Btn, { small: true, kind: 'ghost', icon: 'message', onClick: () => props.go('messages') }, '查看全部')),
          ),
          h(
            'div',
            { className: 'ob-panel-body' },
            recent.length
              ? h('ul', { className: 'ob-feed' }, recent.slice(-8).reverse().map((event, index) => h(EventLine, { key: (event && event.seq) || index, event, now })))
              : h(EmptyState, {
                  tone: 'brand',
                  icon: 'inbox',
                  title: '还没有收到事件',
                  description: '连接 QQ 网关后，收到的消息、通知与请求会实时出现在这里。',
                  action: configured ? null : h(Btn, { small: true, kind: 'secondary', onClick: () => props.go('connect') }, '去配置连接'),
                }),
          ),
        ),

        h(
          Reveal,
          { as: 'section', className: 'ob-panel' },
          h(
            'div',
            { className: 'ob-panel-head with-line' },
            h('div', { className: 'ob-stack', style: { gap: '2px' } }, h('h2', { className: 'ob-panel-title' }, '快捷操作'), h('p', { className: 'ob-panel-desc' }, '作用于已保存的配置；如果刚改过地址，请先保存。')),
          ),
          h(
            'div',
            { className: 'ob-panel-body' },
            h(
              'div',
              { className: 'ob-hero-actions' },
              h(Btn, { kind: 'primary', icon: connected ? 'check' : 'play', onClick: () => act('connect', '连接'), busy: busy === 'connect', disabled: connected || connecting }, connected ? '已连接' : '连接'),
              h(Btn, { icon: 'refresh', onClick: () => act('reconnect', '重连'), busy: busy === 'reconnect' }, '重连'),
              h(Btn, { kind: 'ghost', icon: 'stop', onClick: () => act('disconnect', '断开'), busy: busy === 'disconnect', disabled: gateway.state === 'stopped' }, '断开'),
              h(Btn, { kind: 'ghost', icon: 'settings', onClick: () => props.go('config') }, '配置'),
            ),
          ),
        ),
      )
    }

    // =====================================================================
    // 标签页：连接（stepper / 端点 / SnowLuma / 检测探测 / 状态诊断）
    // =====================================================================

    function Connect(props) {
      const configInfo = props.configInfo
      const draft = props.draft
      const groups = configInfo ? configInfo.groups : null
      const gateway = safeObject(props.status && props.status.gateway)
      const [busy, setBusy] = useState('')
      const [detecting, setDetecting] = useState(false)
      const [detect, setDetect] = useState(null)
      const [probing, setProbing] = useState(false)
      const [probe, setProbe] = useState(null)
      const now = props.now || Date.now()

      if (!configInfo || !draft) {
        return h(
          'div',
          { className: 'ob-page' },
          h(PanelSkeleton, { rows: 4 }),
          h(PanelSkeleton, { rows: 2 }),
        )
      }

      const setField = (path, value) => props.updateDraft((previous) => setByPath(previous || {}, path, value))
      const renderField = (path) => {
        if (props.operationsOnly) return null
        const spec = fieldSpecByPath(groups, path)
        if (!spec) return null
        return h(FieldRow, { key: path, spec, value: getByPath(draft, path), onChange: (value) => setField(path, value), disabled: props.saving })
      }

      const doDetect = async () => {
        setDetecting(true)
        setDetect(null)
        const run = props.runWithProgress || ((task) => task())
        const result = describeDetect(await run(() => get('/gateway/detect')))
        setDetect(result)
        setDetecting(false)
        if (!result.ok) props.toast('检测失败：' + result.message, 'err')
      }

      const doProbe = async () => {
        setProbing(true)
        setProbe(null)
        const run = props.runWithProgress || ((task) => task())
        const result = describeProbe(await run(() => post('/probe', { endpoint: probeEndpointFromDraft(draft) })))
        setProbe(result)
        setProbing(false)
        if (result.ok) props.toast('探测成功', 'ok')
        else props.toast('探测失败：' + (result.error || result.message || '未知错误'), 'err')
      }

      const act = async (name, label) => {
        setBusy(name)
        try {
          await props.gatewayAction(name, label)
        } finally {
          setBusy('')
        }
      }

      const endpoint = safeObject(gateway.endpoint)
      const state = stateLabel(gateway.state)
      const configured = Boolean(gateway.configured)
      const connected = gateway.state === 'connected'
      const connecting = gateway.state === 'connecting'
      const verified = gateway.loginCheck === 'ok'
      const steps = [
        { key: 'address', label: '地址配置', done: configured, on: !configured },
        { key: 'link', label: '建立连接', done: connected, on: configured && !connected },
        { key: 'verify', label: '账号核验', done: verified, on: connected && !verified },
      ]

      return h(
        'div',
        { className: 'ob-page' },
        h(
          Reveal,
          { as: 'section', className: 'ob-panel muted' },
          h(
            'div',
            { className: 'ob-panel-body' },
            h(
              'ol',
              { className: 'ob-stepper' },
              steps.reduce((items, step, index) => {
                items.push(
                  h(
                    'li',
                    { key: step.key, className: cx('ob-step', step.done && 'done', step.on && 'on') },
                    h('span', { className: 'ob-step-index' }, step.done ? h(Icon, { name: 'check', size: 12 }) : String(index + 1)),
                    h('span', null, step.label),
                  ),
                )
                if (index < steps.length - 1) {
                  items.push(h('li', { key: 'line-' + step.key, className: cx('ob-stepper-line', step.done && 'done'), 'aria-hidden': true }))
                }
                return items
              }, []),
            ),
          ),
        ),

        h(
          Reveal,
          { as: 'section', className: 'ob-panel' },
          h(
            'div',
            { className: 'ob-panel-head with-line' },
            h('div', { className: 'ob-stack', style: { gap: '2px' } }, h('h2', { className: 'ob-panel-title' }, '网关与端点'), h('p', { className: 'ob-panel-desc' }, 'OneBot v11 正向 WebSocket 收事件、HTTP 调接口；HTTP 留空时所有调用走 WS。')),
            h('div', { className: 'ob-panel-actions' }, h(Badge, { tone: configured ? 'ok' : 'warn' }, configured ? '已配置' : '未配置')),
          ),
          h(
            'div',
            { className: 'ob-panel-body' },
            renderField('gateway'),
            renderField('onebot.wsUrl'),
            renderField('onebot.httpUrl'),
            renderField('onebot.wsToken'),
            renderField('onebot.httpToken'),
            renderField('onebot.httpAuth'),
            h('div', { className: 'ob-row', style: { marginTop: '10px' } },
              h(Badge, { tone: endpoint.wsConfigured ? 'ok' : 'warn' }, endpoint.wsConfigured ? 'WS 已配置' : 'WS 未配置'),
              h(Badge, { tone: endpoint.httpConfigured ? 'ok' : 'warn' }, endpoint.httpConfigured ? 'HTTP 已配置' : 'HTTP 未配置'),
              endpoint.wsUrlSafe ? h(Code, null, maskEndpoint(endpoint.wsUrlSafe)) : null,
              endpoint.httpUrlSafe ? h(Code, null, maskEndpoint(endpoint.httpUrlSafe)) : null,
            ),
          ),
        ),

        !props.operationsOnly && h(
          Reveal,
          { as: 'section', className: 'ob-panel' },
          h(
            'div',
            { className: 'ob-panel-head with-line' },
            h('div', { className: 'ob-stack', style: { gap: '2px' } }, h('h2', { className: 'ob-panel-title' }, 'SnowLuma 地址读取'), h('p', { className: 'ob-panel-desc' }, 'SnowLuma 模式会从 config/onebot*.json 读取端口与 token；本插件只读，不启动、不注入 SnowLuma。')),
          ),
          h('div', { className: 'ob-panel-body' }, renderField('snowluma.autoDetect'), renderField('snowluma.dir'), renderField('snowluma.uin')),
        ),

        h(
          Reveal,
          { as: 'section', className: 'ob-panel' },
          h(
            'div',
            { className: 'ob-panel-head with-line' },
            h('div', { className: 'ob-stack', style: { gap: '2px' } }, h('h2', { className: 'ob-panel-title' }, '检测与探测'), h('p', { className: 'ob-panel-desc' }, '「检测」只读 SnowLuma 安装与端点解析；「探测」只调用一次 get_login_info，不改变当前连接。')),
            h(
              'div',
              { className: 'ob-panel-actions' },
              h(Btn, { small: true, icon: 'search', onClick: doDetect, busy: detecting }, detecting ? '检测中…' : '检测 SnowLuma'),
              h(Btn, { small: true, kind: 'secondary', icon: 'plug', onClick: doProbe, busy: probing }, probing ? '探测中…' : '探测登录'),
            ),
          ),
          h(
            'div',
            { className: 'ob-panel-body' },
            !detect && !probe
              ? h(EmptyState, {
                  compact: true,
                  tone: 'brand',
                  icon: 'search',
                  title: '还没有检测结果',
                  description: '点上方按钮可以读取 SnowLuma 安装信息，或探测当前 HTTP 端点的登录账号。',
                })
              : null,
            detect
              ? h(
                  'div',
                  { className: 'ob-probe-result ' + (detect.ok ? '' : 'err'), style: { marginBottom: '10px' } },
                  h(SoftIcon, { name: detect.ok ? 'check' : 'alert', tone: detect.ok ? 'ok' : 'err', size: 'small' }),
                  h(
                    'div',
                    { className: 'ob-probe-copy' },
                    h('p', { className: 'ob-probe-title' }, detect.ok ? 'SnowLuma 检测完成' : 'SnowLuma 检测失败'),
                    h('p', { className: 'ob-probe-desc' },
                      detect.snowluma
                        ? (detect.snowluma.installed
                            ? '已安装' + (detect.snowluma.version ? '（v' + detect.snowluma.version + '）' : '') + (detect.snowluma.dir ? '：' + detect.snowluma.dir : '')
                            : '未安装：' + (detect.snowluma.error || '未找到'))
                        : detect.message || '—',
                      detect.endpoint
                        ? '；端点解析：WS ' + (detect.endpoint.wsConfigured ? '已配置' : '未配置') + '，HTTP ' + (detect.endpoint.httpConfigured ? '已配置' : '未配置')
                        : '',
                    ),
                  ),
                )
              : null,
            probe
              ? h(
                  'div',
                  { className: 'ob-probe-result ' + (probe.ok ? 'ok' : 'err') },
                  h(SoftIcon, { name: probe.ok ? 'check' : 'alert', tone: probe.ok ? 'ok' : 'err', size: 'small' }),
                  h(
                    'div',
                    { className: 'ob-probe-copy' },
                    h('p', { className: 'ob-probe-title' }, probe.ok ? '探测成功' : '探测失败'),
                    h('p', { className: 'ob-probe-desc' },
                      probe.ok
                        ? '登录账号 ' + String((probe.login && probe.login.nickname) || '') + (probe.login && probe.login.userId ? '（' + String(probe.login.userId) + '）' : '') + (probe.elapsedMs != null ? '，耗时 ' + probe.elapsedMs + 'ms' : '')
                        : String(probe.error || probe.message || '未知错误'),
                    ),
                  ),
                )
              : null,
          ),
        ),

        h(
          Reveal,
          { as: 'section', className: 'ob-panel' },
          h(
            'div',
            { className: 'ob-panel-head with-line' },
            h('div', { className: 'ob-stack', style: { gap: '2px' } }, h('h2', { className: 'ob-panel-title' }, '连接控制'), h('p', { className: 'ob-panel-desc' }, '操作作用于已保存的配置；改动地址后请先保存再连接。')),
          ),
          h(
            'div',
            { className: 'ob-panel-body' },
            h(
              'div',
              { className: 'ob-hero-actions' },
              h(Btn, { kind: 'primary', icon: 'play', onClick: () => act('connect', '连接'), busy: busy === 'connect', disabled: connected || connecting }, connected ? '已连接' : '连接'),
              h(Btn, { icon: 'refresh', onClick: () => act('reconnect', '重连'), busy: busy === 'reconnect' }, '重连'),
              h(Btn, { kind: 'ghost', icon: 'stop', onClick: () => act('disconnect', '断开'), busy: busy === 'disconnect', disabled: gateway.state === 'stopped' }, '断开'),
            ),
            gateway.lastError
              ? h('div', { className: 'ob-probe-result err', style: { marginTop: '12px' } },
                  h(SoftIcon, { name: 'alert', tone: 'err', size: 'small' }),
                  h('div', { className: 'ob-probe-copy' },
                    h('p', { className: 'ob-probe-title' }, '最近错误'),
                    h('p', { className: 'ob-probe-desc' }, String(gateway.lastError)),
                  ),
                )
              : null,
            h(KV, {
              rows: [
                ['当前状态', h(StatusPill, { tone: state.tone, text: state.text })],
                ['已配置', configured ? '是' : '否'],
                ['连接时间', gateway.connectedAt ? formatRelative(Number(gateway.connectedAt), now) : '—'],
                ['上次断开', gateway.lastDisconnectAt ? formatRelative(Number(gateway.lastDisconnectAt), now) : '—'],
                ['重连次数', gateway.reconnects == null ? '—' : String(gateway.reconnects)],
                ['核验结果', h(Badge, { tone: verified ? 'ok' : gateway.loginCheck === 'mismatch' || gateway.loginCheck === 'error' ? 'err' : 'warn' }, loginCheckLabel(gateway.loginCheck).text)],
              ],
            }),
          ),
        ),
      )
    }

    // =====================================================================
    // 标签页：消息（发送目标列表 / 发送表单 / 事件流）
    // =====================================================================

    function Messages(props) {
      const refreshMs = computeRefreshMs(props.configInfo && props.configInfo.config, props.configInfo && props.configInfo.groups)
      const [chatType, setChatType] = useState('private')
      const [chatId, setChatId] = useState('')
      const [text, setText] = useState('')
      const [sending, setSending] = useState(false)
      const [sendResult, setSendResult] = useState(null)
      const [friends, setFriends] = useState({ loading: false, error: '', items: null })
      const [groups, setGroups] = useState({ loading: false, error: '', items: null })
      const [listTab, setListTab] = useState('friends')
      const [search, setSearch] = useState('')
      const [events, setEvents] = useState([])
      const [eventsError, setEventsError] = useState('')
      const [eventsLoading, setEventsLoading] = useState(true)
      const [paused, setPaused] = useState(false)
      const [kindFilter, setKindFilter] = useState('')
      const sinceRef = useRef(0)
      const pausedRef = useRef(false)
      pausedRef.current = paused
      const now = props.now || Date.now()

      const loadList = useCallback(async (which) => {
        const setState = which === 'friends' ? setFriends : setGroups
        setState((previous) => ({ loading: true, error: '', items: previous.items }))
        const parsed = parseApiResponse(await get('/' + which))
        if (!parsed.ok) {
          setState({ loading: false, error: parsed.message, items: [] })
          return
        }
        setState({ loading: false, error: '', items: safeArray(parsed.data[which]) })
      }, [])

      useEffect(() => {
        loadList('friends')
        loadList('groups')
      }, [loadList])

      const loadEvents = useCallback(async (reset) => {
        const since = reset ? 0 : sinceRef.current
        const parsed = parseApiResponse(await get('/events' + buildQuery({ since, limit: 100 })))
        if (!parsed.ok) {
          setEventsError(parsed.message)
          setEventsLoading(false)
          return
        }
        const items = safeArray(parsed.data.items)
        const serverSince = Number(parsed.data.nextSince)
        sinceRef.current = Number.isFinite(serverSince) ? serverSince : nextSince(items, since)
        setEvents((previous) => (reset ? items.slice() : mergeIncremental(previous, items)))
        setEventsError('')
        setEventsLoading(false)
      }, [])

      useEffect(() => {
        let alive = true
        loadEvents(true)
        const timer = setInterval(() => {
          if (!alive || pausedRef.current || pageHidden()) return
          loadEvents(false)
        }, Math.max(1000, refreshMs))
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [loadEvents, refreshMs])

      useEffect(() => {
        if (!paused) loadEvents(false)
      }, [paused, loadEvents])

      const send = async () => {
        const id = String(chatId || '').trim()
        if (!id) {
          setSendResult({ ok: false, message: '请先填写 ' + (chatType === 'group' ? '群号' : 'QQ 号') })
          return
        }
        if (!String(text || '').trim()) {
          setSendResult({ ok: false, message: '消息内容不能为空' })
          return
        }
        setSending(true)
        setSendResult(null)
        const parsed = parseApiResponse(await post('/send', { chatType, chatId: id, message: text }))
        setSending(false)
        if (!parsed.ok) {
          setSendResult({ ok: false, message: parsed.message })
          props.toast('发送失败：' + parsed.message, 'err')
          return
        }
        const result = safeObject(parsed.data.result)
        const messageId = result.message_id
        setSendResult({ ok: true, message: messageId === undefined || messageId === null ? '已发送' : '已发送，message_id：' + String(messageId) })
        props.toast('消息已发送', 'ok')
        setText('')
      }

      const clearEvents = async () => {
        const parsed = parseApiResponse(await post('/events/clear'))
        if (!parsed.ok) {
          props.toast('清空失败：' + parsed.message, 'err')
          return
        }
        sinceRef.current = 0
        setEvents([])
        props.toast('事件缓冲已清空', 'ok')
        loadEvents(true)
      }

      const filtered = kindFilter ? events.filter((event) => event && event.kind === kindFilter) : events
      const fillTarget = (type, id) => {
        setChatType(type)
        setChatId(String(id || ''))
        props.toast('已填入发送目标', 'ok')
      }

      const keyword = String(search || '').trim().toLowerCase()
      const listState = listTab === 'friends' ? friends : groups
      const listItems = safeArray(listState.items).filter((item) => {
        const normalized = listTab === 'friends' ? normalizeFriend(item) : normalizeGroup(item)
        if (!keyword) return true
        return (normalized.name + ' ' + normalized.id + ' ' + (normalized.nickname || '')).toLowerCase().indexOf(keyword) >= 0
      })

      const renderList = () => {
        if (listState.loading && listState.items === null) {
          return h('div', { className: 'ob-skel-stack', style: { padding: '8px 0' } }, Array.from({ length: 5 }).map((_, index) => h(Skeleton, { key: index, variant: 'text', width: index % 2 ? '76%' : '92%' })))
        }
        if (listState.error) {
          return h(EmptyState, {
            compact: true,
            tone: 'err',
            icon: 'alert',
            title: '列表读取失败',
            description: listState.error,
            action: h(Btn, { small: true, onClick: () => loadList(listTab) }, '重试'),
          })
        }
        if (!listItems.length) {
          return h(EmptyState, {
            compact: true,
            tone: 'brand',
            icon: listTab === 'friends' ? 'users' : 'group',
            title: keyword ? '没有匹配的结果' : listTab === 'friends' ? '没有好友' : '没有群',
            description: keyword ? '换个关键词试试。' : '网关没有返回' + (listTab === 'friends' ? '好友' : '群') + '列表。',
          })
        }
        return h(
          'ul',
          { className: 'ob-list' },
          listItems.map((item, index) => {
            if (listTab === 'friends') {
              const friend = normalizeFriend(item)
              return h(ListItem, {
                key: friend.id || index,
                title: friend.name || friend.id,
                sub: 'QQ ' + (friend.id || '未知') + (friend.nickname && friend.nickname !== friend.name ? ' · ' + friend.nickname : ''),
                initials: String(friend.name || friend.id || '?').slice(0, 1),
                onClick: () => fillTarget('private', friend.id),
              })
            }
            const group = normalizeGroup(item)
            return h(ListItem, {
              key: group.id || index,
              title: group.name || group.id,
              sub: '群 ' + (group.id || '未知') + (group.memberCount != null ? ' · ' + group.memberCount + ' 人' : ''),
              initials: String(group.name || group.id || '?').slice(0, 1),
              onClick: () => fillTarget('group', group.id),
            })
          }),
        )
      }

      return h(
        'div',
        { className: 'ob-page' },
        h(
          'div',
          { className: 'ob-split' },
          h(
            Reveal,
            { as: 'section', className: 'ob-panel' },
            h(
              'div',
              { className: 'ob-panel-head with-line' },
              h('div', { className: 'ob-stack', style: { gap: '2px' } }, h('h2', { className: 'ob-panel-title' }, '发送目标'), h('p', { className: 'ob-panel-desc' }, '点一条填入右侧的发送目标。')),
            ),
            h(
              'div',
              { className: 'ob-panel-body' },
              h(
                'div',
                { className: 'ob-stack' },
                h(
                  'div',
                  { className: 'ob-row', style: { justifyContent: 'space-between' } },
                  h(Seg, {
                    value: listTab,
                    label: '列表类型',
                    options: [{ value: 'friends', label: '好友' }, { value: 'groups', label: '群' }],
                    onChange: (value) => {
                      setListTab(value)
                      setSearch('')
                    },
                  }),
                  h(IconBtn, { small: true, title: '刷新列表', icon: 'refresh', onClick: () => loadList(listTab) }),
                ),
                h(
                  'label',
                  { className: 'ob-search' },
                  h(Icon, { name: 'search', size: 14 }),
                  h('input', { value: search, placeholder: '搜索名称或号码', onChange: (event) => setSearch(event.target.value), 'aria-label': '搜索列表' }),
                ),
                renderList(),
              ),
            ),
          ),
          h(
            'div',
            { className: 'ob-stack' },
            h(
              Reveal,
              { as: 'section', className: 'ob-panel' },
              h(
                'div',
                { className: 'ob-panel-head with-line' },
                h('div', { className: 'ob-stack', style: { gap: '2px' } }, h('h2', { className: 'ob-panel-title' }, '发送消息'), h('p', { className: 'ob-panel-desc' }, '消息文本原样交给 OneBot 网关；message_id 显示在下方。')),
              ),
              h(
                'div',
                { className: 'ob-panel-body' },
                h(
                  'div',
                  { className: 'ob-composer' },
                  h(
                    'div',
                    { className: 'ob-field', style: { padding: 0 } },
                    h('div', { className: 'ob-field-label' }, '会话类型'),
                    h('div', { className: 'ob-composer-row' }, h(Seg, { value: chatType, label: '会话类型', options: [{ value: 'private', label: '私聊' }, { value: 'group', label: '群聊' }], onChange: setChatType })),
                  ),
                  h(
                    'div',
                    { className: 'ob-field', style: { padding: 0 } },
                    h('label', { className: 'ob-field-label', htmlFor: 'ob-send-chatid' }, chatType === 'group' ? '群号' : 'QQ 号'),
                    h('input', { id: 'ob-send-chatid', className: 'ob-input', type: 'text', inputMode: 'numeric', value: chatId, placeholder: chatType === 'group' ? '例如 123456789' : '例如 10001', onChange: (event) => setChatId(event.target.value) }),
                  ),
                  h(
                    'div',
                    { className: 'ob-field', style: { padding: 0 } },
                    h('label', { className: 'ob-field-label', htmlFor: 'ob-send-text' }, '消息内容'),
                    h('textarea', { id: 'ob-send-text', className: 'ob-textarea', rows: 4, value: text, placeholder: '输入要发送的文字', onChange: (event) => setText(event.target.value) }),
                  ),
                  h(
                    'div',
                    { className: 'ob-hero-actions' },
                    h(Btn, { kind: 'primary', icon: 'send', onClick: send, busy: sending, disabled: sending }, sending ? '发送中…' : '发送'),
                    h(Btn, { kind: 'ghost', onClick: () => { setText(''); setSendResult(null) } }, '清空输入'),
                  ),
                  sendResult
                    ? h(
                        'div',
                        { className: 'ob-send-result ' + (sendResult.ok ? 'ok' : 'err') },
                        h(Icon, { name: sendResult.ok ? 'check' : 'alert', size: 14 }),
                        h('span', null, sendResult.message),
                      )
                    : null,
                ),
              ),
            ),
            h(
              Reveal,
              { as: 'section', className: 'ob-panel' },
              h(
                'div',
                { className: 'ob-panel-head with-line' },
                h('div', { className: 'ob-stack', style: { gap: '2px' } }, h('h2', { className: 'ob-panel-title' }, '事件流'), h('p', { className: 'ob-panel-desc' }, '增量拉取宿主事件缓冲；过滤只影响显示，不影响缓冲。')),
                h(
                  'div',
                  { className: 'ob-panel-actions' },
                  h(
                    'select',
                    { className: 'ob-select', style: { width: 'auto', height: 'var(--ob-control-sm)' }, value: kindFilter, 'aria-label': '按事件类型过滤', onChange: (event) => setKindFilter(event.target.value) },
                    h('option', { value: '' }, '全部类型'),
                    EVENT_KINDS.map((kind) => h('option', { key: kind, value: kind }, eventKindLabel(kind))),
                  ),
                  h(IconBtn, { small: true, title: paused ? '继续自动刷新' : '暂停自动刷新', icon: paused ? 'play' : 'pause', onClick: () => setPaused((value) => !value) }),
                  h(IconBtn, { small: true, title: '清空事件缓冲', icon: 'trash', onClick: clearEvents }),
                  h(IconBtn, { small: true, title: '刷新事件', icon: 'refresh', onClick: () => loadEvents(true) }),
                ),
              ),
              h(
                'div',
                { className: 'ob-panel-body' },
                paused ? h('p', { className: 'ob-feed-meta', style: { marginTop: 0 } }, '已暂停：不再自动拉取新事件，点播放按钮恢复。') : null,
                eventsError
                  ? h(Banner, {
                      tone: 'err',
                      message: '事件拉取失败：' + eventsError,
                      actions: [h(Btn, { key: 'retry', small: true, kind: 'secondary', onClick: () => loadEvents(false) }, '重试')],
                    })
                  : null,
                eventsLoading
                  ? h('div', { className: 'ob-skel-stack' }, Array.from({ length: 4 }).map((_, index) => h(Skeleton, { key: index, variant: 'text', width: index % 2 ? '72%' : '94%' })))
                  : !filtered.length
                    ? h(EmptyState, {
                        compact: true,
                        tone: 'brand',
                        icon: 'inbox',
                        title: events.length ? '没有符合过滤条件的事件' : '事件缓冲是空的',
                        description: events.length ? '切换类型过滤再看看。' : '收到 QQ 事件后会实时出现在这里。',
                      })
                    : h(
                        'ul',
                        { className: 'ob-feed', role: 'log', 'aria-label': '事件流', style: { maxHeight: '520px', overflow: 'auto' } },
                        filtered.slice(-120).reverse().map((event, index) => h(EventLine, { key: (event && event.seq) || index, event, now })),
                      ),
              ),
            ),
          ),
        ),
      )
    }

    // =====================================================================
    // 标签页：配置（持久化设置壳：左分组导航固定，右侧只切换当前分组）
    // =====================================================================

    function ConfigTab(props) {
      const configInfo = props.configInfo
      const draft = props.draft
      const groups = useMemo(
        () => systemFieldSpecs(configInfo && configInfo.groups).filter((group) => group.id !== 'ui' && !String(group.id).startsWith('cog-')),
        [configInfo],
      )
      const [active, setActive] = useState(props.navigation?.section || '')
      useEffect(() => { if (props.navigation?.section) setActive(props.navigation.section) }, [props.navigation])
      useEffect(() => {
        if (!groups.length) return
        if (!groups.some((group) => group.id === active)) setActive(groups[0].id)
      }, [groups, active])

      if (!configInfo || !draft) {
        return h('div', { className: 'ob-page' }, h(PanelSkeleton, { rows: 5 }))
      }
      if (!groups.length) {
        return h(
          'div',
          { className: 'ob-page' },
          h(Panel, null, h(EmptyState, {
            tone: 'err',
            icon: 'alert',
            title: '服务端没有返回可渲染的字段表',
            description: 'groups 为空，面板无法生成配置表单。',
            action: h(Btn, { small: true, onClick: () => props.refreshAll() }, '重新读取'),
          })),
        )
      }

      const activeGroup = groups.find((group) => group.id === active) || groups[0]
      const setField = (path, value) => props.updateDraft((previous) => setByPath(previous || {}, path, value))
      const items = groups.map((group) => ({
        id: group.id,
        label: group.title,
        icon: configGroupIcon(group.id),
        description: group.description || '',
      }))

      return h(
        'div',
        { className: 'ob-page' },
        props.issues.length
          ? h(Banner, {
              tone: 'warn',
              message: h('span', null, '保存结果有 ' + props.issues.length + ' 条提示：', h('ul', { className: 'ob-issue-list' }, props.issues.map((issue, index) => h('li', { key: index }, issue)))),
            })
          : null,
        h(
          SettingsShell,
          {
            items,
            active: activeGroup.id,
            onSelect: setActive,
            label: '配置分组',
            footer: h(
              Panel,
              {
                title: '保存与重置',
                description: '保存会规范化字段并把非法值回退为默认值；恢复默认会立即写盘，需要确认。',
                footer: h(
                  'div',
                  { className: 'ob-row' },
                  h(Btn, { kind: 'primary', icon: 'check', onClick: () => props.save(), busy: props.saving, disabled: props.saving || !props.dirty }, props.saving ? '保存中…' : '保存配置'),
                  h(Btn, { kind: 'ghost', onClick: props.undo, disabled: props.saving || !props.dirty }, '撤销改动'),
                  h(Btn, { kind: 'danger', onClick: props.reset, disabled: props.saving }, '恢复默认'),
                ),
              },
              h('p', { className: 'ob-note' }, '快捷键：', h(Kbd, null, 'Ctrl'), ' + ', h(Kbd, null, 'S'), ' 保存。分组切换只替换右侧内容，页头与导航保持不动。'),
            ),
          },
          h(
            Panel,
            { title: activeGroup.title, description: activeGroup.description || undefined },
            activeGroup.fields.map((field) =>
              h(FieldRow, { key: field.path, spec: field, value: getByPath(draft, field.path), onChange: (value) => setField(field.path, value), disabled: props.saving }),
            ),
          ),
        ),
      )
    }

    // =====================================================================
    // 标签页：日志（级别过滤 / 暂停 / 清空）
    // =====================================================================

    function Logs(props) {
      const refreshMs = computeRefreshMs(props.configInfo && props.configInfo.config, props.configInfo && props.configInfo.groups)
      const [level, setLevel] = useState('')
      const [paused, setPaused] = useState(false)
      const [entries, setEntries] = useState([])
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(true)
      const sinceRef = useRef(0)
      const levelRef = useRef('')
      const pausedRef = useRef(false)
      const firstLevelRef = useRef(true)
      pausedRef.current = paused
      const now = props.now || Date.now()

      const load = useCallback(async (reset) => {
        const since = reset ? 0 : sinceRef.current
        const parsed = parseApiResponse(await get('/logs' + buildQuery({ since, level: levelRef.current, limit: 200 })))
        if (!parsed.ok) {
          setError(parsed.message)
          setLoading(false)
          return
        }
        const items = safeArray(parsed.data.items).map(normalizeLogEntry)
        const serverSince = Number(parsed.data.nextSince)
        sinceRef.current = Number.isFinite(serverSince) ? serverSince : nextSince(items, since)
        setEntries((previous) => (reset ? items.slice() : mergeIncremental(previous, items)))
        setError('')
        setLoading(false)
      }, [])

      useEffect(() => {
        let alive = true
        load(true)
        const timer = setInterval(() => {
          if (!alive || pausedRef.current || pageHidden()) return
          load(false)
        }, Math.max(1000, refreshMs))
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [load, refreshMs])

      useEffect(() => {
        if (firstLevelRef.current) {
          firstLevelRef.current = false
          return
        }
        levelRef.current = level
        sinceRef.current = 0
        setLoading(true)
        load(true)
      }, [level, load])

      useEffect(() => {
        if (!paused) load(false)
      }, [paused, load])

      const clearLogs = async () => {
        const parsed = parseApiResponse(await post('/logs/clear'))
        if (!parsed.ok) {
          props.toast('清空日志失败：' + parsed.message, 'err')
          return
        }
        sinceRef.current = 0
        setEntries([])
        props.toast('日志缓冲已清空', 'ok')
        load(true)
      }

      const counts = useMemo(() => {
        const result = { debug: 0, info: 0, warn: 0, error: 0 }
        for (const entry of entries) {
          if (result[entry.level] !== undefined) result[entry.level] += 1
        }
        return result
      }, [entries])

      return h(
        'div',
        { className: 'ob-page' },
        h(
          Reveal,
          { as: 'section', className: 'ob-panel' },
          h(
            'div',
            { className: 'ob-panel-head with-line' },
            h('div', { className: 'ob-stack', style: { gap: '2px' } }, h('h2', { className: 'ob-panel-title' }, '日志缓冲区'), h('p', { className: 'ob-panel-desc' }, paused ? '已暂停：不再自动拉取新日志。' : '自动刷新中（每 ' + refreshMs + ' 毫秒增量拉取一次）。')),
            h(
              'div',
              { className: 'ob-panel-actions' },
              h(
                'select',
                { className: 'ob-select', style: { width: 'auto', height: 'var(--ob-control-sm)' }, value: level, 'aria-label': '日志级别过滤', onChange: (event) => setLevel(event.target.value) },
                h('option', { value: '' }, '全部级别'),
                LOG_LEVELS.map((name) => h('option', { key: name, value: name }, name)),
              ),
            ),
          ),
          h(
            'div',
            { className: 'ob-panel-body' },
            error
              ? h(Banner, {
                  tone: 'err',
                  message: '日志拉取失败：' + error,
                  actions: [h(Btn, { key: 'retry', small: true, kind: 'secondary', onClick: () => load(false) }, '重试')],
                })
              : null,
            loading
              ? h('div', { className: 'ob-log', style: { '--ob-log-loading': 'true' } }, Array.from({ length: 8 }).map((_, index) => h(Skeleton, { key: index, variant: 'text', width: index % 3 ? '86%' : '64%' })))
              : !entries.length
                ? h(EmptyState, {
                    compact: true,
                    tone: 'brand',
                    icon: 'logs',
                    title: '还没有日志',
                    description: '宿主日志缓冲为空；触发一次连接或操作后会出现日志。',
                  })
                : h(
                    'div',
                    { className: 'ob-log', role: 'log', 'aria-label': '插件日志' },
                    entries.slice(-400).reverse().map((entry, index) => h(LogLine, { key: entry.seq === undefined ? index : entry.seq, entry, now })),
                  ),
          ),
        ),
      )
    }

    // =====================================================================
    // 标签页：关于
    // =====================================================================

    function About(props) {
      const configInfo = props.configInfo || {}
      const status = props.status || {}
      const version = configInfo.version || status.version || '—'
      const apiVersion = configInfo.apiVersion || status.apiVersion
      const dataDir = configInfo.dataDir || status.dataDir || '—'
      const [copied, setCopied] = useState(false)
      const copyDir = async () => {
        try {
          await navigator.clipboard.writeText(String(dataDir))
          setCopied(true)
          props.toast('数据目录已复制', 'ok')
          setTimeout(() => setCopied(false), 1600)
        } catch (error) {
          props.toast('复制失败：' + (error && error.message ? error.message : String(error)), 'err')
        }
      }
      const capabilities = [
        ['plug', '连接管理', '连接已有 OneBot v11 正向 WS / HTTP 网关（NapCat / SnowLuma / Lagrange / LLOneBot）。'],
        ['shield', '只读 SnowLuma', 'SnowLuma 模式只读取它自己的 config/onebot*.json，不下载、不启动、不注入。'],
        ['bolt', '事件规范化', '消息 / 通知 / 请求 / 元事件统一规范化并进入环形缓冲，供后续记忆与认知插件消费。'],
        ['config', '全量可配置', '重连退避、超时、过滤、缓冲容量、日志级别、界面偏好全部来自服务端配置。'],
        ['message', '消息发送', '私聊 / 群聊文本发送，返回 message_id 与错误信息。'],
        ['logs', '可观测性', '状态、事件、日志、账号核验与连接诊断都可在面板查看。'],
      ]
      return h(
        'div',
        { className: 'ob-page' },
        h(
          Reveal,
          { as: 'section', className: 'ob-panel brand' },
          h(
            'div',
            { className: 'ob-panel-body' },
            h(
              'div',
              { className: 'ob-about-hero' },
              h('span', { className: 'ob-about-mark' }, h(OneBotIcon, { size: 30 })),
              h(
                'div',
                { className: 'ob-about-detail' },
                h('h2', { className: 'ob-about-name' }, 'dsh-bot'),
                h('p', { className: 'ob-about-desc' }, 'QQ 感知与执行接入层：只负责与 OneBot 网关通信和提供面板；人格、记忆、认知与行为策略由后续插件在本层之上构建。'),
              ),
            ),
          ),
        ),
        h(
          Reveal,
          { className: 'ob-grid two' },
          h(
            Panel,
            { title: '版本与数据', description: '插件版本、接口版本与宿主数据目录。' },
            h(KV, {
              rows: [
                ['插件名', 'dsh-bot'],
                ['插件版本', String(version)],
                ['接口版本', apiVersion === undefined || apiVersion === null ? '—' : String(apiVersion)],
                ['数据目录', h('span', { className: 'ob-row', style: { gap: '8px' } }, h(Code, null, String(dataDir)), h(Btn, { small: true, kind: 'ghost', icon: 'copy', onClick: copyDir }, copied ? '已复制' : '复制'))],
                ['许可证', 'MIT'],
              ],
            }),
          ),
          h(
            Panel,
            { title: '能力与边界', description: '这里列出的能力全部由当前插件自身实现。' },
            h(
              'div',
              { className: 'ob-grid', style: { gap: '10px' } },
              capabilities.map((item) =>
                h(
                  'div',
                  { key: item[1], className: 'ob-row', style: { alignItems: 'flex-start', flexWrap: 'nowrap' } },
                  h(SoftIcon, { name: item[0], tone: 'brand', size: 'small' }),
                  h('div', { style: { minWidth: 0 } }, h('p', { className: 'ob-feed-text', style: { margin: 0, fontWeight: 'var(--ob-weight-label)' } }, item[1]), h('p', { className: 'ob-field-help', style: { margin: 0 } }, item[2])),
                ),
              ),
            ),
          ),
        ),
        h(
          Reveal,
          { as: 'section', className: 'ob-panel' },
          h(
            'div',
            { className: 'ob-panel-head with-line' },
            h('div', { className: 'ob-stack', style: { gap: '2px' } }, h('h2', { className: 'ob-panel-title' }, '第三方与许可'), h('p', { className: 'ob-panel-desc' }, 'SnowLuma / NapCat 是独立第三方项目，仅作为外部网关地址接入。')),
          ),
          h(
            'div',
            { className: 'ob-panel-body' },
            h(KV, {
              rows: [
                ['本项目许可', 'MIT'],
                ['参考实现', 'aureth-labs/dsh-aurabot-qq（MIT）：OneBot 客户端、数据目录、脱敏、日志与面板写法参考'],
                ['UI/UX 参考', 'console-web（用户自有项目）：设计令牌、动效配方与页面结构参考，未复制源码'],
                ['OneBot 协议', h(LinkOut, { href: 'https://github.com/botuniverse/onebot-11' }, 'OneBot v11 规范')],
              ],
            }),
            h('p', { className: 'ob-note', style: { marginTop: '12px' } }, '使用非官方 QQ 工具存在账号风险，建议使用小号；本插件不提供也不修改任何网关实现。'),
          ),
        ),
      )
    }

    // =====================================================================
    // 标签页：系统设置（参考 console-web preferences：持久设置壳 + 即时保存）
    //
    // 布局（持久化壳）：页头 / 全局标签栏 / 左侧分类导航都不在右内容容器内，
    // 切换分类只替换右侧 .ob-settings-pane（ob-swap 仅淡入，不整页滑动）。
    // 主题由 DSH theme service 控制（全 DSH 生效）；其余偏好走 ui.* 配置并即时保存。
    // =====================================================================

    const PAGE_TRANSITION_HINTS = {
      default: '轻微上移 + 淡入（推荐）',
      fade: '仅淡入，不位移',
      'fade-slide': '从右侧轻移入',
      'fade-up': '从下方轻移入',
      'fade-down': '从上方轻移入',
      none: '关闭页面切换动画',
    }

    function configGroupIcon(id) {
      switch (id) {
        case 'ui':
          return 'palette'
        case 'gateway':
          return 'connect'
        case 'onebot':
          return 'plug'
        case 'snowluma':
          return 'search'
        case 'reconnect':
        case 'timeouts':
          return 'refresh'
        case 'events':
          return 'bolt'
        case 'logging':
          return 'logs'
        case 'security':
          return 'shield'
        default:
          return 'config'
      }
    }

    /** 配置/系统设置共用的持久设置壳：左导航固定，右侧只换当前分类内容。 */
    function SettingsShell(props) {
      const items = safeArray(props.items)
      return h(
        'div',
        { className: 'ob-settings' },
        h(
          'nav',
          { className: 'ob-settings-nav', 'aria-label': props.label || '设置分类' },
          items.map((item) =>
            h(
              'button',
              {
                key: item.id,
                type: 'button',
                className: cx('ob-settings-nav-btn', props.active === item.id && 'on'),
                'aria-current': props.active === item.id ? 'page' : undefined,
                onClick: () => props.onSelect(item.id),
              },
              h(Icon, { name: item.icon || 'config', size: 15 }),
              h('span', { className: 'ob-truncate' }, item.label),
            ),
          ),
        ),
        h(
          'div',
          { className: 'ob-settings-content' },
          h('div', { key: props.active, className: 'ob-settings-pane ob-swap' }, props.children),
          props.footer || null,
        ),
      )
    }

    function SettingFieldBlock(props) {
      return h(
        'div',
        { className: 'ob-field', id: props.path ? 'ob-field-' + props.path.replace(/[^a-zA-Z0-9_-]/g, '-') : undefined, 'data-field': props.path },
        h('div', { className: 'ob-field-label' }, props.label),
        props.hint ? h('p', { className: 'ob-field-help' }, props.hint) : null,
        h('div', { className: 'ob-field-control' }, props.children),
      )
    }

    function SettingOptionGrid(props) {
      const options = safeArray(props.options)
      return h(
        'div',
        { className: 'ob-option-grid' },
        options.map((option) =>
          h(
            'button',
            {
              key: String(option.value),
              type: 'button',
              className: cx('ob-option-card', option.value === props.value && 'on'),
              'aria-pressed': option.value === props.value,
              onClick: () => props.onChange(option.value),
            },
            h('span', { className: 'ob-option-label' }, h('span', null, option.label), props.icon ? h(Icon, { name: props.icon(option) }) : null),
            props.renderPreview ? h('span', { className: 'ob-option-preview' }, props.renderPreview(option)) : null,
          ),
        ),
      )
    }

    function ThemePreview(props) {
      return h(
        'span',
        { className: 'ob-theme-preview', 'data-theme-preview': props.value, 'aria-hidden': true },
        h('span', { className: 'ob-theme-preview-bar', style: { width: '42%' } }),
        h('span', { className: 'ob-theme-preview-bar', style: { width: '70%' } }),
        h('span', { className: 'ob-theme-preview-surface' }),
      )
    }

    function DensityPreview(props) {
      return h(
        'span',
        { className: 'ob-preview-density', 'data-density-preview': props.value, 'aria-hidden': true },
        [0, 1, 2].map((row) => h('span', { key: row }, h('i', null), h('b', null))),
      )
    }

    function FontPreview(props) {
      return h('span', { className: 'ob-preview-font', 'data-font-preview': props.value, 'aria-hidden': true }, 'Aa 面板预览')
    }

    function WidthPreview(props) {
      return h('span', { className: 'ob-preview-width', 'data-width-preview': props.value, 'aria-hidden': true }, h('span', null))
    }

    function AccentSwatch(props) {
      const tone = accentValues(props.value, false)
      const style = tone ? { background: tone.brand } : { background: 'linear-gradient(135deg, var(--ob-ink), var(--ob-ink-muted))' }
      return h('span', { className: 'ob-swatch', style, 'aria-hidden': true })
    }

    function PreferenceSaveStatus(props) {
      const status = props.status || {}
      if (status.error) return h('span', { className: 'ob-settings-status err' }, h('i', { className: 'ob-dot', 'aria-hidden': true }), '保存失败')
      if (status.saving) return h('span', { className: 'ob-settings-status' }, h(BusyIndicator, { label: '保存中', showLabel: false }), '保存中…')
      return h('span', { className: 'ob-settings-status ok' }, h('i', { className: 'ob-dot', 'aria-hidden': true }), status.savedAt ? '已保存 · ' + formatTime(status.savedAt) : '已保存')
    }

    function ThemeControl(props) {
      const theme = props.theme
      if (!theme || !theme.available) {
        return h(EmptyState, {
          compact: true,
          tone: 'warn',
          icon: 'alert',
          title: '主题服务不可用',
          description: '当前环境没有 DSH theme service，无法在这里切换全局主题；其它面板偏好仍可修改。',
        })
      }
      const current = theme.preference
      const known = THEME_OPTIONS.some((option) => option.value === current)
      const currentLabel = !known && current ? '当前：自定义主题「' + current + '」' : ''
      return h(
        'div',
        { className: 'ob-stack', style: { width: '100%' } },
        h(SettingOptionGrid, {
          options: THEME_OPTIONS,
          value: current,
          onChange: (value) => theme.setTheme(value),
          icon: (option) => option.icon,
          renderPreview: (option) => h(ThemePreview, { value: option.value }),
        }),
        h(
          'div',
          { className: 'ob-row' },
          h(Badge, { tone: 'brand' }, '当前渲染：' + (theme.activeScheme === 'dark' ? '深色' : '浅色')),
          currentLabel ? h(Badge, { tone: 'info' }, currentLabel) : null,
          h('span', { className: 'ob-hint-inline' }, '与 DSH 自带外观设置同步，改动立即作用于整个 DSH。'),
        ),
      )
    }

    function SettingsOptionField(props) {
      const field = props.field
      const value = props.value
      const onChange = props.onChange
      if (!field) return null
      const options = safeArray(field.options)
      if (field.path === 'ui.accent') {
        return h(SettingFieldBlock, { path: field.path, label: field.label, hint: field.help }, h(
          'div',
          { className: 'ob-accent-grid' },
          options.map((option) =>
            h(
              'button',
              {
                key: String(option.value),
                type: 'button',
                className: cx('ob-accent-card', option.value === value && 'on'),
                'aria-pressed': option.value === value,
                title: option.label,
                onClick: () => onChange(option.value),
              },
              h(AccentSwatch, { value: option.value }),
              h('span', { className: 'ob-truncate' }, option.label),
            ),
          ),
        ))
      }
      if (field.path === 'ui.density') {
        return h(SettingFieldBlock, { path: field.path, label: field.label, hint: field.help }, h(SettingOptionGrid, {
          options,
          value,
          onChange,
          renderPreview: (option) => h(DensityPreview, { value: option.value }),
        }))
      }
      if (field.path === 'ui.fontScale') {
        return h(SettingFieldBlock, { path: field.path, label: field.label, hint: field.help }, h(SettingOptionGrid, {
          options,
          value,
          onChange,
          renderPreview: (option) => h(FontPreview, { value: option.value }),
        }))
      }
      if (field.path === 'ui.contentWidth') {
        return h(SettingFieldBlock, { path: field.path, label: field.label, hint: field.help }, h(SettingOptionGrid, {
          options,
          value,
          onChange,
          renderPreview: (option) => h(WidthPreview, { value: option.value }),
        }))
      }
      if (field.path === 'ui.pageTransition') {
        return h(
          SettingFieldBlock,
          { path: field.path, label: field.label, hint: field.help },
          h(
            'div',
            { className: 'ob-stack', style: { width: '100%', gap: '6px' } },
            h(
              'select',
              { className: 'ob-select', value: value == null ? '' : String(value), onChange: (event) => onChange(event.target.value), 'aria-label': field.label },
              options.map((option) => h('option', { key: String(option.value), value: String(option.value) }, option.label)),
            ),
            h('p', { className: 'ob-field-help', style: { margin: 0 } }, PAGE_TRANSITION_HINTS[value] || '页面切换动画只影响顶层标签；配置与系统设置内部切换始终只淡入。'),
          ),
        )
      }
      if (!options.length) {
        return h(FieldRow, { spec: field, value, onChange })
      }
      return h(
        SettingFieldBlock,
        { path: field.path, label: field.label, hint: field.help },
        h(Seg, {
          value,
          label: field.label,
          options: options.map((option) => ({ value: option.value, label: option.label })),
          onChange,
        }),
      )
    }

    function SettingsSummary(props) {
      const rows = []
      if (props.theme && props.theme.available) {
        const preference = props.theme.preference
        const option = THEME_OPTIONS.find((item) => item.value === preference)
        rows.push(['DSH 主题', option ? option.label : preference ? '自定义：' + preference : '—'])
      }
      for (const field of props.fields) {
        const value = getByPath(props.draft, field.path)
        const option = safeArray(field.options).find((item) => item.value === value)
        rows.push([field.label, option ? option.label : String(value == null ? '—' : value)])
      }
      rows.push(['解析后的对比度', props.contrast === 'high' ? '高对比度' : '标准'])
      return h(KV, { rows })
    }

    function SettingsTab(props) {
      const configInfo = props.configInfo
      const draft = props.draft
      const sections = useMemo(() => settingsSections(configInfo && configInfo.groups), [configInfo])
      const [active, setActive] = useState('appearance')
      const [revision, setRevision] = useState(0)
      const theme = useClientTheme()
      const systemReduced = useSystemReducedMotion()
      const systemMoreContrast = useSystemMoreContrast()
      const ui = safeObject((draft && draft.ui) || (configInfo && configInfo.config && configInfo.config.ui))
      const prefs = normalizeUiPreferences(ui)
      const motionMode = resolveMotionMode(prefs.motion, systemReduced)
      const contrast = resolveContrast(prefs.contrast, systemMoreContrast)

      if (!configInfo || !draft) {
        return h('div', { className: 'ob-page' }, h(PanelSkeleton, { rows: 5 }))
      }
      if (!sections.length) {
        return h(
          'div',
          { className: 'ob-page' },
          h(Panel, null, h(EmptyState, {
            tone: 'err',
            icon: 'alert',
            title: '没有可渲染的界面偏好',
            description: '服务端 ui 分组为空。请检查 CONFIG_GROUPS，或刷新后再试。',
            action: h(Btn, { small: true, onClick: () => props.refreshAll() }, '刷新'),
          })),
        )
      }

      const requestedSection = props.ownerIntegration && sections.find(section => props.navigation?.fieldPath ? section.fields.some(field => field.path === props.navigation.fieldPath) : section.id === props.navigation?.anchor)
      const activeSection = requestedSection || sections.find((section) => section.id === active) || sections[0]
      const allFields = sections.flatMap((section) => section.fields)
      const saveStatus = props.prefStatus || {}
      const updateField = (path, value) => props.saveUiPatch({ [path]: value })
      const themeLabel = theme.available
        ? THEME_OPTIONS.find((option) => option.value === theme.preference) ? THEME_OPTIONS.find((option) => option.value === theme.preference).label : theme.preference || '—'
        : '不可用'

      const renderSectionBody = () => {
        if (activeSection.id === 'reset') {
          return h(
            Panel,
            { title: '当前生效值', description: '这些值来自服务端配置与 DSH 主题；修改会即时保存。' },
            h(SettingsSummary, { fields: allFields, draft, theme, contrast }),
            h(
              'div',
              { className: 'ob-settings-note', style: { marginTop: '14px' } },
              h('p', { className: 'ob-field-help', style: { margin: 0 } }, '主题由 DSH 管理；「恢复默认外观」只重置 ui.*，不影响主题、连接与账号配置。'),
              h(Btn, { small: true, kind: 'danger', icon: 'refresh', onClick: () => {
                const confirmed = typeof window !== 'undefined' && typeof window.confirm === 'function'
                  ? window.confirm('恢复默认界面偏好？只会重置 ui.*（强调色/对比度/密度/字号/内容宽度/动效/页面转场），主题与连接配置不受影响。')
                  : true
                if (!confirmed) return
                const patch = {}
                for (const field of allFields) patch[field.path] = field.default
                props.saveUiPatch(patch)
                props.toast('已恢复默认界面偏好', 'ok')
              } }, '恢复默认外观'),
            ),
          )
        }
        if (activeSection.id === 'other') {
          return h(
            Panel,
            { title: activeSection.title, description: activeSection.description },
            activeSection.fields.map((field) =>
              h(FieldRow, { key: field.path, spec: field, value: getByPath(draft, field.path), onChange: (value) => updateField(field.path, value), disabled: saveStatus.saving }),
            ),
          )
        }
        return h(
          Panel,
          {
            title: activeSection.id === 'appearance' ? '主题与强调色' : activeSection.id === 'layout' ? '空间与阅读' : activeSection.id === 'data' ? '数据与刷新' : '动效与转场',
            description: activeSection.id === 'appearance'
              ? '主题是 DSH 全局设置；强调色与对比度只影响本面板。'
              : activeSection.id === 'layout'
                ? '调整面板的密度、字号和内容宽度；保存后立即生效。'
                : activeSection.id === 'data' ? '状态轮询与事件、日志分页；保存后按下一次读取生效。' : '动效模式与页面转场；配置/系统设置内部切换始终只做淡入。',
          },
          activeSection.id === 'appearance'
            ? h(
                'div',
                { className: 'ob-stack' },
                h(SettingFieldBlock, { label: 'DSH 主题', hint: '浅色 / 深色 / 跟随系统；作用范围是整个 DSH，而不仅是本面板。' }, h(ThemeControl, { theme })),
                activeSection.fields.map((field) => h(SettingsOptionField, {
                  key: field.path,
                  field,
                  value: getByPath(draft, field.path),
                  onChange: (value) => updateField(field.path, value),
                })),
              )
            : activeSection.fields.map((field) => h(SettingsOptionField, {
                key: field.path,
                field,
                value: getByPath(draft, field.path),
                onChange: (value) => updateField(field.path, value),
              })),
          activeSection.id === 'motion'
            ? h(
                'div',
                { className: 'ob-settings-note', style: { marginTop: '14px' } },
                h('div', { className: 'ob-stack', style: { gap: '2px' } }, h('p', { className: 'ob-field-label', style: { margin: 0 } }, '预览内容切换'), h('p', { className: 'ob-field-help', style: { margin: 0 } }, '配置/系统设置内部切换使用同一套淡入，不做整页滑动。')),
                h(Btn, { small: true, icon: 'play', onClick: () => setRevision((value) => value + 1) }, '播放预览'),
                h('div', { className: 'ob-option-preview', style: { width: '160px' } }, h('div', { key: revision, className: 'ob-swap', style: { padding: '10px', fontSize: 'var(--ob-text-small)' } }, '内容切换预览 ' + (revision + 1))),
              )
            : null,
        )
      }

      return h(
        'div',
        { className: 'ob-page' },
        props.prefStatus && props.prefStatus.error
          ? h(Banner, {
              tone: 'err',
              message: '界面偏好保存失败：' + props.prefStatus.error,
              actions: [h(Btn, { key: 'retry', small: true, kind: 'secondary', onClick: () => props.retryPrefSave() }, '重试')],
            })
          : null,
        h(
          'div',
          { className: 'ob-settings' },
          h(
            'nav',
            { className: 'ob-settings-nav', 'aria-label': '系统设置分类' },
            h('p', { className: 'ob-settings-nav-title' }, '显示与偏好'),
            sections.map((section) =>
              h(
                'button',
                {
                  key: section.id,
                  type: 'button',
                  className: cx('ob-settings-nav-btn', activeSection.id === section.id && 'on'),
                  'aria-current': activeSection.id === section.id ? 'page' : undefined,
                  onClick: () => { if (props.ownerIntegration) props.goTo?.({ area: 'system', section: 'appearance', anchor: section.id }); else setActive(section.id) },
                },
                h(Icon, { name: section.icon || 'config', size: 15 }),
                h('span', { className: 'ob-truncate' }, section.title),
              ),
            ),
          ),
          h(
            'div',
            { className: 'ob-settings-content' },
            h(
              'div',
              { className: 'ob-settings-pane ob-swap', key: activeSection.id },
              h(
                'div',
                { className: 'ob-spread' },
                h(
                  'div',
                  { className: 'ob-stack', style: { gap: '2px', minWidth: 0 } },
                  h('h2', { className: 'ob-settings-heading' }, activeSection.title),
                  h('p', { className: 'ob-settings-description' }, activeSection.description),
                ),
                h('div', { className: 'ob-row' }, h(PreferenceSaveStatus, { status: saveStatus })),
              ),
              renderSectionBody(),
            ),
            h(
              'p',
              { className: 'ob-note' },
              '即时保存：每次修改都会写入服务端配置，不需要再点保存；主题通过 DSH theme service 切换。当前动效模式 ',
              h(Badge, { tone: motionMode === 'full' ? 'ok' : 'warn' }, motionMode),
              ' · 对比度 ',
              h(Badge, { tone: contrast === 'high' ? 'info' : 'muted' }, contrast === 'high' ? '高' : '标准'),
              ' · 主题 ',
              h(Badge, { tone: 'brand' }, themeLabel),
              '。',
            ),
          ),
        ),
      )
    }
    // =====================================================================
    // 顶层标签：模型（协议、provider、端点、密钥、发现、测试与路由）
    // 密钥从不下发到浏览器；空值保存 = 保持原 key。
    // =====================================================================

    const MODEL_PROTOCOL_LABELS = {
      'openai-completions': 'OpenAI Chat Completions',
      'openai-responses': 'OpenAI Responses',
      'anthropic-messages': 'Anthropic Messages',
      'gemini-generate-content': 'Gemini generateContent',
      'ollama-chat': 'Ollama Chat',
    }

    function ModelTag(props) {
      return h(Badge, { tone: props.tone || 'muted' }, props.children || props.label)
    }

    function ModelField(props) {
      return h(
        'div',
        { className: 'ob-field' },
        h('label', { className: 'ob-field-label' }, props.label, props.required ? h('span', { className: 'ob-muted' }, ' *') : null),
        h('div', { className: 'ob-field-control' }, props.children),
        props.hint ? h('p', { className: 'ob-field-help' }, props.hint) : null,
      )
    }

    function modelKeySourceLabel(source) {
      return source === 'env' ? '来自环境变量' : source === 'stored' ? '已保存到本地' : '未配置'
    }

    function ModelStatus(props) {
      const item = safeObject(props.item)
      const failed = Number(item.consecutiveFailures || 0) > 0
      return h(
        'div',
        { className: 'ob-row' },
        h(ModelTag, { tone: failed ? 'warn' : 'ok' }, failed ? '最近失败' : '最近成功'),
        item.lastLatencyMs ? h('span', { className: 'ob-small ob-muted' }, Number(item.lastLatencyMs) + 'ms') : null,
        item.lastUsage ? h('span', { className: 'ob-small ob-muted' }, 'tokens ' + String(item.lastUsage.total || 0)) : null,
      )
    }

    function useModelData(props) {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(true)
      const alive = useRef(true)
      const load = useCallback(async () => {
        setLoading(true)
        try {
          const parsed = parseApiResponse(await get('/models'))
          if (!alive.current) return
          if (!parsed.ok) setError(parsed.message)
          else { setData(parsed.data); setError('') }
        } catch (err) {
          if (alive.current) setError(String(err && err.message ? err.message : err))
        } finally {
          if (alive.current) setLoading(false)
        }
      }, [])
      useEffect(() => {
        alive.current = true
        load()
        return () => { alive.current = false }
      }, [load])
      return { data, error, loading, reload: load }
    }

    async function modelPost(props, path, body) {
      try {
        const parsed = parseApiResponse(await post(path, body || {}))
        if (!parsed.ok) { props.toast(parsed.message || '操作失败', 'err'); return null }
        return parsed.data
      } catch (err) {
        props.toast('操作失败：' + String(err && err.message ? err.message : err), 'err')
        return null
      }
    }

    function ModelTab(props) {
      const api = useModelData(props)
      const data = api.data || {}
      const providers = safeArray(data.providers)
      const presets = safeArray(data.presets)
      const [activeId, setActiveId] = useState('')
      const [editing, setEditing] = useState(null)
      const [creating, setCreating] = useState(false)
      const [presetId, setPresetId] = useState('opencode-go')
      const [saving, setSaving] = useState(false)
      const [testing, setTesting] = useState(false)
      const [testResult, setTestResult] = useState(null)
      const [discovery, setDiscovery] = useState(null)
      const [discovering, setDiscovering] = useState(false)
      const draft = props.draft || (props.configInfo && props.configInfo.config) || {}
      const mode = String(getByPath(draft, 'cognition.llm.mode') || 'auto')

      useEffect(() => {
        if (creating) return
        if (!providers.length) { setActiveId(''); setEditing(null); return }
        const next = providers.some((item) => item.id === activeId) ? activeId : providers[0].id
        if (next !== activeId) { setActiveId(next); setEditing(providerDraft(providers.find((item) => item.id === next))); setTestResult(null); setDiscovery(null) }
      }, [providers.length, activeId, creating])

      const active = providers.find((item) => item.id === activeId) || null
      const selected = safeObject(data.selected)
      const health = safeObject(active && data.health && data.health[active.id])

      function providerDraft(provider) {
        if (!provider) return null
        return {
          id: provider.id,
          name: provider.name,
          preset: provider.preset || '',
          protocol: provider.protocol,
          baseUrl: provider.baseUrl,
          requestPath: provider.requestPath,
          modelsPath: provider.modelsPath,
          authType: provider.authType || provider.auth?.type || 'bearer',
          authHeader: provider.auth?.header || '',
          authPrefix: provider.auth?.prefix || '',
          apiKeyEnv: provider.apiKeyEnv || '',
          apiKey: '',
          clearApiKey: false,
          headersText: JSON.stringify(provider.headers || {}, null, 2),
          sessionHeader: provider.sessionHeader || '',
          modelsText: (provider.models || []).map((model) => model.id).join('\n'),
          timeoutMs: provider.timeoutMs || 45000,
          stream: provider.stream !== false,
          maxRetries: provider.maxRetries == null ? 1 : provider.maxRetries,
          enabled: provider.enabled !== false,
          notes: provider.notes || '',
        }
      }

      function selectProvider(provider) {
        setCreating(false)
        setActiveId(provider.id)
        setEditing(providerDraft(provider))
        setTestResult(null)
        setDiscovery(null)
      }

      function changeField(key, value) {
        setEditing((previous) => Object.assign({}, previous, { [key]: value }))
      }

      function addProvider() {
        const preset = presets.find((item) => item.id === presetId) || presets[0]
        if (!preset) return
        setCreating(true)
        setEditing({
          id: preset.id === 'custom' ? 'custom-' + Date.now().toString(36) : preset.id,
          name: preset.label,
          preset: preset.id,
          protocol: preset.protocol,
          baseUrl: preset.baseUrl || '',
          requestPath: preset.requestPath || (preset.protocol === 'anthropic-messages' ? '/v1/messages' : '/chat/completions'),
          modelsPath: preset.modelsPath || '/models',
          authType: preset.auth?.type || 'bearer',
          authHeader: preset.auth?.header || '',
          authPrefix: preset.auth?.prefix || '',
          apiKeyEnv: preset.apiKeyEnv || '',
          apiKey: '',
          clearApiKey: false,
          headersText: JSON.stringify(preset.headers || {}, null, 2),
          sessionHeader: preset.sessionHeader || '',
          modelsText: '',
          timeoutMs: 45000,
          stream: true,
          maxRetries: 1,
          enabled: true,
          notes: preset.notes || '',
        })
        setActiveId('')
        setTestResult(null)
        setDiscovery(null)
      }

      function parseModelsText(text) {
        return String(text || '').split('\n').map((line) => line.trim()).filter(Boolean).map((id) => ({ id, label: id }))
      }

      async function save() {
        if (!editing) return
        let headers = {}
        try {
          headers = editing.headersText.trim() ? JSON.parse(editing.headersText) : {}
          if (!isPlainObject(headers)) throw new Error('headers 必须是 JSON 对象')
        } catch (err) {
          props.toast('额外 header JSON 不合法：' + String(err.message || err), 'err')
          return
        }
        const provider = {
          id: editing.id,
          name: editing.name,
          preset: editing.preset,
          protocol: editing.protocol,
          baseUrl: editing.baseUrl,
          requestPath: editing.requestPath,
          modelsPath: editing.modelsPath,
          auth: { type: editing.authType, header: editing.authType === 'none' ? '' : (editing.authHeader || (editing.authType === 'bearer' ? 'Authorization' : 'x-api-key')), prefix: editing.authType === 'bearer' ? 'Bearer ' : editing.authPrefix },
          apiKeyEnv: editing.apiKeyEnv,
          apiKey: editing.apiKey,
          clearApiKey: editing.clearApiKey,
          headers,
          sessionHeader: editing.sessionHeader,
          models: parseModelsText(editing.modelsText),
          timeoutMs: Number(editing.timeoutMs) || 45000,
          stream: Boolean(editing.stream),
          maxRetries: Number(editing.maxRetries) || 0,
          enabled: Boolean(editing.enabled),
          notes: editing.notes,
        }
        if (provider.auth.header === undefined) delete provider.auth.header
        setSaving(true)
        const result = await modelPost(props, '/models/provider', { provider })
        setSaving(false)
        if (!result) return
        setCreating(false)
        props.toast('模型 provider 已保存', 'ok')
        setEditing(providerDraft(result.provider))
        setActiveId(result.provider.id)
        await api.reload()
      }

      async function remove() {
        if (!editing || !window.confirm('删除这个模型 provider？已保存的 key 也会被移除。')) return
        const result = await modelPost(props, '/models/provider/delete', { providerId: editing.id })
        if (!result) return
        props.toast('模型 provider 已删除', 'ok')
        setCreating(false)
        setEditing(null)
        setActiveId('')
        await api.reload()
      }

      async function test() {
        if (!editing) return
        const model = parseModelsText(editing.modelsText)[0]?.id || (selected.model || '')
        if (!model) { props.toast('请先填写至少一个模型 ID', 'err'); return }
        setTesting(true)
        setTestResult(null)
        const result = await modelPost(props, '/models/provider/test', { providerId: editing.id, model })
        setTesting(false)
        if (!result) return
        setTestResult(result.result)
        await api.reload()
      }

      async function discover() {
        if (!editing) return
        setDiscovering(true)
        const result = await modelPost(props, '/models/provider/discover', { providerId: editing.id })
        setDiscovering(false)
        if (!result) return
        setDiscovery(result.result)
        props.toast('发现 ' + safeArray(result.result.models).length + ' 个模型', 'ok')
      }

      async function selectActive() {
        if (!editing) return
        const model = parseModelsText(editing.modelsText)[0]?.id
        if (!model) { props.toast('请先填写模型 ID', 'err'); return }
        const result = await modelPost(props, '/models/select', { provider: editing.id, model })
        if (!result) return
        props.toast('已设为直连模型', 'ok')
        await api.reload()
      }

      async function setFallback(providerId, model) {
        const current = safeArray(data.fallback).map((item) => ({ provider: item.provider, model: item.model }))
        if (current.some((item) => item.provider === providerId && item.model === model)) return
        const result = await modelPost(props, '/models/fallback', { fallback: [...current, { provider: providerId, model }] })
        if (result) { props.toast('已加入备用路由', 'ok'); await api.reload() }
      }

      async function clearFallback(providerId, model) {
        const next = safeArray(data.fallback).filter((item) => !(item.provider === providerId && item.model === model)).map((item) => ({ provider: item.provider, model: item.model }))
        const result = await modelPost(props, '/models/fallback', { fallback: next })
        if (result) { await api.reload() }
      }

      const modeOptions = [
        { value: 'auto', label: '自动（DSH 优先）' },
        { value: 'dsh', label: '仅 DSH' },
        { value: 'fixed', label: 'DSH 固定' },
        { value: 'direct', label: '仅直连' },
        { value: 'chain', label: '直连 → DSH' },
      ]
      return h(
        'div',
        { className: 'ob-stack', style: { gap: '16px' } },
        api.error ? h(Banner, { tone: 'err', message: '模型 API 不可用：' + api.error, actions: h(Btn, { small: true, kind: 'ghost', onClick: api.reload }, '重试') }) : null,
        h(
          Panel,
          { title: '模型路由', description: '统一模型协议：OpenAI / Responses / Anthropic / Gemini / Ollama，以及 OpenCode Go、Command Code、OpenRouter 等中转。', actions: h(Btn, { small: true, kind: 'ghost', icon: 'refresh', onClick: api.reload }, '刷新') },
          h(
            'div',
            { className: 'ob-grid two' },
            !props.ownerIntegration && h(ModelField, { label: '路由模式', hint: 'auto 保持 DSH 优先；direct 只走本页直连；chain 先直连链再回退 DSH。' },
              h('select', { className: 'ob-select', value: mode, onChange: (event) => props.saveUiPatch({ 'cognition.llm.mode': event.target.value }), 'aria-label': '模型路由模式' }, modeOptions.map((option) => h('option', { key: option.value, value: option.value }, option.label))),
            ),
            h(ModelField, { label: '直连状态', hint: selected.resolved ? '当前直连路由' : '尚未选择直连模型' },
              h('div', { className: 'ob-stack', style: { gap: '6px' } },
                selected.resolved ? h('div', { className: 'ob-row' }, h(ModelTag, { tone: 'ok' }, selected.provider + ' / ' + selected.model), h(ModelTag, { tone: 'muted' }, selected.protocolLabel || selected.protocol || '') ) : h('span', { className: 'ob-small ob-muted' }, '在右侧选择 provider 后点「设为直连」'),
                !props.ownerIntegration && h('label', { className: 'ob-row ob-small' }, h('input', { type: 'checkbox', checked: getByPath(draft, 'cognition.llm.fallbackToDsh') !== false, onChange: (event) => props.saveUiPatch({ 'cognition.llm.fallbackToDsh': event.target.checked }) }), '直连失败回退 DSH'),
              ),
            ),
          ),
          selected.resolved ? h('div', { className: 'ob-row' }, h('span', { className: 'ob-small ob-muted' }, '备用路由：'), safeArray(data.fallback).length ? safeArray(data.fallback).map((item) => h('span', { key: item.provider + '/' + item.model, className: 'ob-row' }, h(ModelTag, { tone: 'muted' }, (item.provider || '') + ' / ' + (item.model || '')), h(Btn, { small: true, kind: 'ghost', onClick: () => clearFallback(item.provider, item.model) }, '移除'))) : h('span', { className: 'ob-small ob-muted' }, '无')) : null,
        ),
        h(
          'div',
          { className: 'ob-models-grid' },
          h(
            Panel,
            { title: 'Provider', description: '密钥只保存在本地；环境变量优先。', actions: h(Btn, { small: true, kind: 'primary', icon: 'plus', onClick: addProvider }, '新增') },
            h(
              'div',
              { className: 'ob-stack', style: { gap: '8px' } },
              h('div', { className: 'ob-row' },
                h('select', { className: 'ob-select', value: presetId, onChange: (event) => setPresetId(event.target.value), 'aria-label': 'provider 预设' }, presets.map((preset) => h('option', { key: preset.id, value: preset.id }, preset.label))),
              ),
              api.loading ? h(CogLoading) : providers.length ? h('div', { className: 'ob-stack', style: { gap: '6px' } }, providers.map((provider) =>
                h('button', { key: provider.id, type: 'button', className: cx('ob-model-provider', activeId === provider.id && 'on'), onClick: () => selectProvider(provider) },
                  h('span', { className: 'ob-model-provider-main' },
                    h('span', { className: 'ob-row' }, h(ModelTag, { tone: selected.provider === provider.id ? 'brand' : 'muted' }, provider.name), provider.enabled === false ? h(ModelTag, { tone: 'warn' }, '禁用') : null),
                    h('span', { className: 'ob-small ob-muted ob-truncate' }, provider.protocol + ' · ' + (provider.baseUrl || '')),
                    h('span', { className: 'ob-row ob-small ob-muted' }, h('span', null, safeArray(provider.models).length + ' 个模型'), h('span', null, provider.hasApiKey ? '已配置 key' : '未配置 key'), h('span', null, provider.apiKeySource === 'env' ? 'env' : 'local')),
                  ),
                  h(Icon, { name: 'chevron', size: 14 }),
                ),
              )) : h(EmptyState, { compact: true, title: '还没有 provider', description: '从上方选一个预设，然后新增并填写模型 ID。' }),
            ),
          ),
          h(
            Panel,
            { title: editing ? editing.name || editing.id : 'Provider 编辑器', description: editing ? '空 API key = 保持不变；敏感 header 值显示为 ***。' : '选择左侧 provider 或新增。' },
            editing ? h(
              'div',
              { className: 'ob-stack', style: { gap: '10px' } },
              h('div', { className: 'ob-grid two' },
                h(ModelField, { label: 'ID', hint: '创建后不可改；小写字母/数字/._-' }, h('input', { className: 'ob-input', value: editing.id, disabled: providers.some((item) => item.id === editing.id), onChange: (event) => changeField('id', event.target.value.trim()) })),
                h(ModelField, { label: '显示名' }, h('input', { className: 'ob-input', value: editing.name, onChange: (event) => changeField('name', event.target.value) })),
                h(ModelField, { label: '协议' }, h('select', { className: 'ob-select', value: editing.protocol, onChange: (event) => changeField('protocol', event.target.value) }, (safeArray(data.protocols).length ? safeArray(data.protocols) : Object.keys(MODEL_PROTOCOL_LABELS).map((id) => ({ id, label: MODEL_PROTOCOL_LABELS[id] }))).map((protocol) => h('option', { key: protocol.id, value: protocol.id }, protocol.label || MODEL_PROTOCOL_LABELS[protocol.id] || protocol.id)))),
                h(ModelField, { label: 'Base URL', hint: '不要带 /chat/completions；可以带 /v1 或 /provider/v1。' }, h('input', { className: 'ob-input', value: editing.baseUrl, onChange: (event) => changeField('baseUrl', event.target.value) })),
                h(ModelField, { label: '请求路径', hint: '留空使用协议默认；Command Code 用 /chat/completions 或 /messages。' }, h('input', { className: 'ob-input', value: editing.requestPath, onChange: (event) => changeField('requestPath', event.target.value) })),
                h(ModelField, { label: '模型列表路径' }, h('input', { className: 'ob-input', value: editing.modelsPath, onChange: (event) => changeField('modelsPath', event.target.value) })),
                h(ModelField, { label: '认证方式' }, h('select', { className: 'ob-select', value: editing.authType, onChange: (event) => changeField('authType', event.target.value) }, [['bearer', 'Authorization: Bearer'], ['x-api-key', 'x-api-key'], ['header', '自定义 header'], ['none', '无认证']].map(([value, label]) => h('option', { key: value, value }, label)))),
                h(ModelField, { label: '认证 header（可选）', hint: 'header 认证时使用，例如 X-API-Key' }, h('input', { className: 'ob-input', value: editing.authHeader, disabled: editing.authType !== 'header', onChange: (event) => changeField('authHeader', event.target.value) })),
                h(ModelField, { label: '认证前缀（可选）', hint: '例如 Bearer 或 Token' }, h('input', { className: 'ob-input', value: editing.authPrefix, onChange: (event) => changeField('authPrefix', event.target.value) })),
                h(ModelField, { label: 'API key 环境变量', hint: '优先读环境变量，例如 OPENCODE_GO_API_KEY' }, h('input', { className: 'ob-input', value: editing.apiKeyEnv, onChange: (event) => changeField('apiKeyEnv', event.target.value) })),
              ),
              h(ModelField, { label: 'API key', hint: active ? (active.hasApiKey ? '已配置（' + modelKeySourceLabel(active.apiKeySource) + '；后四位 ' + String(active.apiKeyHint || '') + '）' : '未配置') : '仅本地保存，不会回传浏览器' },
                h('div', { className: 'ob-row', style: { width: '100%' } },
                  h('input', { className: 'ob-input', type: 'password', autoComplete: 'new-password', placeholder: active && active.hasApiKey ? '留空保持不变' : '输入 key', value: editing.apiKey, onChange: (event) => changeField('apiKey', event.target.value) }),
                  h('label', { className: 'ob-row ob-small' }, h('input', { type: 'checkbox', checked: editing.clearApiKey, onChange: (event) => changeField('clearApiKey', event.target.checked) }), '清除已保存 key'),
                ),
              ),
              h(ModelField, { label: '模型 ID', hint: '每行一个；可在下方发现后应用。' }, h('textarea', { className: 'ob-textarea', rows: 4, value: editing.modelsText, onChange: (event) => changeField('modelsText', event.target.value) })),
              h('details', { className: 'ob-model-advanced' },
                h('summary', null, '高级：headers / session / 超时 / 重试'),
                h('div', { className: 'ob-stack', style: { gap: '10px', marginTop: '8px' } },
                  h(ModelField, { label: '额外 headers（JSON）', hint: '例如 HTTP-Referer / X-Title；认证 header 用上方配置。' }, h('textarea', { className: 'ob-textarea', rows: 4, value: editing.headersText, onChange: (event) => changeField('headersText', event.target.value) })),
                  h('div', { className: 'ob-grid two' },
                    h(ModelField, { label: 'Session header', hint: 'OpenCode Go 必须为 x-opencode-session' }, h('input', { className: 'ob-input', value: editing.sessionHeader, onChange: (event) => changeField('sessionHeader', event.target.value) })),
                    h(ModelField, { label: '超时（ms）' }, h('input', { className: 'ob-input', type: 'number', value: editing.timeoutMs, onChange: (event) => changeField('timeoutMs', event.target.value) })),
                    h(ModelField, { label: '重试次数' }, h('input', { className: 'ob-input', type: 'number', min: 0, max: 5, value: editing.maxRetries, onChange: (event) => changeField('maxRetries', event.target.value) })),
                    h(ModelField, { label: '流式' }, h('label', { className: 'ob-row' }, h('input', { type: 'checkbox', checked: editing.stream, onChange: (event) => changeField('stream', event.target.checked) }), '启用 SSE/NDJSON 流')),
                  ),
                ),
              ),
              h('div', { className: 'ob-row' },
                h(Btn, { kind: 'primary', icon: 'check', busy: saving, onClick: save }, '保存'),
                h(Btn, { kind: 'ghost', icon: 'play', busy: testing, onClick: test }, '测试'),
                h(Btn, { kind: 'ghost', icon: 'search', busy: discovering, onClick: discover }, '发现模型'),
                h(Btn, { kind: 'ghost', icon: 'target', onClick: selectActive }, '设为直连'),
                h(Btn, { kind: 'ghost', icon: 'link', onClick: () => { const model = parseModelsText(editing.modelsText)[0]?.id; if (!model) { props.toast('请先填写模型 ID', 'err'); return } setFallback(editing.id, model) } }, '设为备用'),
                active ? h(Btn, { kind: 'danger', icon: 'trash', onClick: remove }, '删除') : null,
              ),
              active ? h('div', { className: 'ob-row' }, h(ModelStatus, { item: health }), h('span', { className: 'ob-small ob-muted' }, active.hasApiKey ? '密钥：' + modelKeySourceLabel(active.apiKeySource) + ' ' + active.apiKeyHint : '密钥：未配置')) : null,
              testResult ? h(
                'div',
                { className: cx('ob-model-test', testResult.ok ? 'ok' : 'err') },
                h('div', { className: 'ob-spread' }, h('strong', null, testResult.ok ? '测试通过' : '测试失败'), h(ModelTag, { tone: testResult.ok ? 'ok' : 'err' }, testResult.code || testResult.protocol || '')),
                h('p', { className: 'ob-small' }, testResult.ok ? `${testResult.provider} / ${testResult.model} · ${testResult.latencyMs}ms · tokens ${testResult.usage?.total || 0} · ${testResult.textPreview || ''}` : String(testResult.message || '')),
              ) : null,
              discovery ? h(
                'div',
                { className: 'ob-model-discovery' },
                h('div', { className: 'ob-spread' }, h('strong', null, '发现模型 ' + safeArray(discovery.models).length), h(Btn, { small: true, kind: 'ghost', onClick: () => { changeField('modelsText', safeArray(discovery.models).map((item) => item.id).join('\n')); setDiscovery(null) } }, '应用全部')),
                h('div', { className: 'ob-model-candidates' }, safeArray(discovery.models).slice(0, 30).map((item) => h('span', { key: item.id, className: 'ob-model-candidate' }, item.id))),
              ) : null,
            ) : h(EmptyState, { compact: true, title: '编辑一个 provider', description: '密钥不会从服务端返回；留空保存表示保持原 key。' }),
          ),
        ),
        h(Panel, { title: '协议与预设', description: '预设只填端点/协议/认证；模型 ID 可发现或手填。' },
          h('div', { className: 'ob-model-protocols' }, safeArray(data.protocols).map((protocol) => h('div', { key: protocol.id, className: 'ob-model-protocol' }, h('strong', null, protocol.label || protocol.id), h('span', { className: 'ob-small ob-muted' }, protocol.id)))),
          h('div', { className: 'ob-row', style: { marginTop: '10px' } }, presets.map((preset) => h(ModelTag, { key: preset.id, tone: 'muted' }, preset.label))),
          h('p', { className: 'ob-field-help' }, '外部模型输出只作为生成/分析结果，不执行其中的指令；密钥不进入日志、trace 或 API 返回值。'),
        ),
      )
    }
    // =====================================================================
    // 标签页：认知（人格/人物/关系/记忆/情绪/策略/学习/技能/元认知/设置）
    // 复用持久设置壳；页面只读 API，写操作走 cognition 服务，不直接改配置。
    // =====================================================================

    const COG_SECTIONS = [
      { id: 'overview', label: '状态', icon: 'brain' },
      { id: 'persona', label: '人格', icon: 'sparkles' },
      { id: 'persons', label: '人物', icon: 'users' },
      { id: 'relationships', label: '关系', icon: 'link' },
      { id: 'memories', label: '记忆', icon: 'memory' },
      { id: 'timeline', label: '时间轴', icon: 'clock' },
      { id: 'emotion', label: '情绪', icon: 'heart' },
      { id: 'purpose', label: '目的', icon: 'target' },
      { id: 'policy', label: '策略', icon: 'target' },
      { id: 'proactivity', label: '主动行为', icon: 'bolt' },
      { id: 'loop', label: '闭环', icon: 'link' },
      { id: 'learning', label: '学习', icon: 'book' },
      { id: 'skills', label: '技能', icon: 'chart' },
      { id: 'meta', label: '元认知', icon: 'chart' },
      { id: 'settings', label: '设置', icon: 'sliders' },
    ]

    function CogPct(value) {
      const n = Number(value)
      return Number.isFinite(n) ? Math.round(clamp01(n) * 100) + '%' : '—'
    }

    function CogBar(props) {
      const value = clamp01(Number(props.value) || 0)
      return h(
        'div',
        { className: 'ob-cog-meter', 'aria-label': (props.label || '') + ' ' + CogPct(value) },
        h('div', { className: 'ob-cog-meter-head' }, h('span', null, props.label || ''), h('span', { className: 'ob-muted' }, props.text || CogPct(value))),
        h('div', { className: 'ob-meter' }, h('div', { className: 'ob-meter-fill', style: { width: (value * 100).toFixed(1) + '%' } })),
      )
    }

    function CogTag(props) {
      return h(Badge, { tone: props.tone || 'muted' }, props.children || props.label)
    }

    function CogToolbar(props) {
      return h('div', { className: 'ob-row ob-cog-toolbar' }, props.children)
    }

    function CogLoading(props) {
      return h('div', { className: 'ob-stack', style: { gap: '8px' } }, [0, 1, 2].map((index) => h(Skeleton, { key: index, variant: 'text', width: index % 2 ? '72%' : '94%' })))
    }

    function CogSearch(props) {
      return h(
        'span',
        { className: 'ob-input-wrap ob-cog-search' },
        h(Icon, { name: 'search', size: 15 }),
        h('input', {
          className: 'ob-input',
          type: 'search',
          value: props.value || '',
          placeholder: props.placeholder || '搜索',
          'aria-label': props.placeholder || '搜索',
          onChange: (event) => props.onChange(event.target.value),
          onKeyDown: (event) => { if (event.key === 'Enter' && props.onSubmit) props.onSubmit() },
        }),
      )
    }

    function CogEmpty(props) {
      return h(EmptyState, { compact: true, title: props.title || '暂无数据', description: props.description || '', icon: props.icon || 'inbox' })
    }

    function useCognitionOverview(props) {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(true)
      const aliveRef = useRef(true)
      const load = useCallback(async () => {
        try {
          const parsed = parseApiResponse(await get('/cognition/overview'))
          if (!aliveRef.current) return
          if (!parsed.ok) setError(parsed.message)
          else { setData(parsed.data); setError('') }
        } catch (err) {
          if (aliveRef.current) setError(String(err && err.message ? err.message : err))
        } finally {
          if (aliveRef.current) setLoading(false)
        }
      }, [])
      useEffect(() => {
        aliveRef.current = true
        load()
        const timer = setInterval(load, 5000)
        return () => { aliveRef.current = false; clearInterval(timer) }
      }, [load])
      return { data, error, loading, reload: load }
    }

    function useCogApi(props, path, { auto = true } = {}) {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(Boolean(auto))
      const aliveRef = useRef(true)
      const load = useCallback(async () => {
        setLoading(true)
        try {
          const parsed = parseApiResponse(await get(path))
          if (!aliveRef.current) return
          if (!parsed.ok) setError(parsed.message)
          else { setData(parsed.data); setError('') }
        } catch (err) {
          if (aliveRef.current) setError(String(err && err.message ? err.message : err))
        } finally {
          if (aliveRef.current) setLoading(false)
        }
      }, [path])
      useEffect(() => {
        aliveRef.current = true
        if (auto) load()
        return () => { aliveRef.current = false }
      }, [auto, load])
      return { data, error, loading, reload: load }
    }

    async function cogPost(props, path, body) {
      try {
        const parsed = parseApiResponse(await post(path, body || {}))
        if (!parsed.ok) {
          props.toast(parsed.message || '操作失败', 'err')
          return null
        }
        return parsed.data
      } catch (err) {
        props.toast('操作失败：' + String(err && err.message ? err.message : err), 'err')
        return null
      }
    }

    // Navigation destinations and actions are host-owned, never read from external manifests.
    /** @typedef {{tab:string, section?:string, moduleId?:string, anchor?:string, decisionId?:string, taskId?:string}} NavigationTarget */
    const navigationTarget = goTo
    const MODULE_DESTINATIONS = Object.freeze({
      'builtin-media-features': [{ label: 'B站公共内容', target: { tab: 'modules', moduleId: 'builtin-media-features', anchor: 'panel' } }, { label: '表情包库', target: { tab: 'media', anchor: 'stickers' } }],
      'builtin-proactivity': [{ label: '主动行为', target: { tab: 'cognition', section: 'proactivity' } }],
      'builtin-learning': [{ label: '学习', target: { tab: 'cognition', section: 'learning' } }],
      'builtin-reminders': [{ label: '提醒数据', target: { tab: 'modules', moduleId: 'builtin-reminders', anchor: 'reminders' } }],
    })
    const ACTION_LABELS = Object.freeze({ 'module.enable': '启用', 'module.disable': '停用', 'module.restart': '重启', 'module.reload': '重载', 'proactivity.runOnce': '执行一次主动行为', 'learning.runPending': '运行待处理' })
    const moduleStatusLabel = status => ({ loaded: '运行中', disabled: '已停用', blocked: '依赖受阻', error: '加载失败', loading: '加载中' })[status] || '状态未知'
    const operationTerminal = operation => ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(operation?.status)
    const operationSucceeded = operation => operation?.status === 'succeeded' && operation?.result?.ok === true
    const observedValue = value => value == null ? '未观察' : typeof value === 'boolean' ? (value ? '是' : '否') : String(value)
    function destinationButton(props, label, target) {
      return h(Btn, { small: true, kind: 'ghost', onClick: () => props.goTo?.(target) }, label)
    }
    function moduleBacklink(props, moduleId) {
      return destinationButton(props, '返回模块详情', { tab: 'modules', moduleId })
    }
    function useNavigationAnchor(props, prefix, ready = true) {
      useEffect(() => {
        if (!ready || !props.navigation?.anchor) return
        // The normalized default module anchor is a page landing, below the heading.
        if (['detail', 'ob-module-detail'].includes(props.navigation.anchor)) return
        // Run after the destination has committed, including same-tab requests.
        const timer = setTimeout(() => document.getElementById(props.navigation.anchor.startsWith('ob-') ? props.navigation.anchor : prefix + props.navigation.anchor)?.scrollIntoView?.({ block: 'start' }), 0)
        return () => clearTimeout(timer)
      }, [props.navigation, prefix, ready])
    }
    function metadataRows(data, keys, { labels = {}, code = true } = {}) {
      return h('dl', { className: 'ob-module-metadata ob-small' }, keys.map(key => {
        const value = Array.isArray(data?.[key]) ? (data[key].join('、') || '无') : observedValue(data?.[key])
        return h('div', { key, className: 'ob-module-metadata-row' }, h('dt', null, labels[key] || key), h('dd', null, code ? h('code', { className: 'ob-module-code', tabIndex: 0 }, value) : value))
      }))
    }
    function moduleHealthSummary(health, loading, error) {
      if (error) return { headline: '需要注意', reason: '健康信息读取失败，请刷新重试。' }
      if (!health) return { headline: loading ? '加载中' : '需要注意', reason: loading ? '正在读取模块健康状态。' : '尚无可用健康观测，不能判断运行正常。' }
      const reasons = {
        MODULE_LOADING: '模块正在加载，请稍候。', MODULE_DISABLED: '模块已停用，启用后恢复运行。', MODULE_STOPPED: '模块已停止运行。',
        DEPENDENCY_BLOCKED: '所需依赖尚未就绪，请检查依赖模块。', STOP_PENDING: '正在等待任务排空，停止尚未完成。',
        PROVIDER_UNAVAILABLE: '服务提供者不可用，请查看技术详情。', MODULE_SETUP_FAILED: '模块加载失败，请检查配置与依赖。',
        BUSINESS_DISABLED: '功能开关已关闭，模块保持空闲。', QUIET_HOURS: '当前处于安静时段。', BUDGET_EXHAUSTED: '当前预算已用尽。',
        NO_TASK: '当前没有待处理任务。', NO_CANDIDATE: '当前没有合适的执行对象。', BUSY: '当前任务正在执行。',
      }
      let headline = '需要注意', reason = '健康观测不足，请查看技术详情。'
      if (health.lifecycle === 'error' || health.health === 'unhealthy') { headline = '错误'; reason = '模块报告错误，请检查配置、依赖和最近错误。' }
      else if (health.lifecycle === 'blocked' || health.health === 'degraded' || health.phase === 'draining' || health.reasonCode === 'STOP_PENDING') { reason = '模块运行受限，请查看原因与技术详情。' }
      else if (health.reasonCode === 'MODULE_LOADING' || health.phase === 'starting') { headline = '加载中'; reason = '模块正在启动，请稍候。' }
      else if (health.health === 'stopped' || health.lifecycle === 'disabled') { headline = '已停止'; reason = '模块当前未运行。' }
      else if (health.health === 'healthy') { headline = '运行正常'; reason = '最近健康观测正常；空闲时不代表正在执行任务。' }
      return { headline, reason: reasons[health.reasonCode] || reason }
    }
    function CoreModuleHealth(props) {
      const api = useCogApi(props, '/modules/health?id=' + encodeURIComponent(props.moduleId))
      const health = safeArray(api.data?.items).find(row => row.moduleId === props.moduleId)
      useEffect(() => { props.onSnapshot?.(health || null) }, [health, props.onSnapshot])
      const summary = moduleHealthSummary(health, api.loading, api.error)
      return h(Panel, { className: 'ob-module-scope', title: '模块健康', description: '最近一次核心观测；刷新健康不会重启模块。', actions: h(Btn, { small: true, onClick: api.reload }, '刷新健康') },
        h('div', { className: 'ob-stack' },
          h('h3', { className: 'ob-module-health-headline' }, summary.headline),
          h('p', { className: 'ob-muted ob-small' }, summary.reason),
        ),
        api.error ? h(Banner, { tone: 'err', message: api.error }) : null,
        health ? h(Fragment, null,
          metadataRows(health, ['lifecycle', 'phase', 'health', 'reasonCode'], { labels: { lifecycle: '运行状态', phase: '工作阶段', health: '健康', reasonCode: '原因代码' } }),
          h('details', { className: 'ob-module-technical' }, h('summary', null, '健康技术详情'),
            metadataRows(health, ['runtimeGeneration', 'telemetryGeneration', 'observedAt', 'reasons']),
            h('h3', null, '最近错误 · lastError'), health.lastError ? metadataRows(health.lastError, ['reasonCode', 'observedAt', 'runtimeGeneration']) : h('p', null, '未观察'),
            h('h3', null, 'Provider 注册与实际所有者'),
            safeArray(health.providers).length ? health.providers.map(row => h('div', { key: row.name }, metadataRows(row, ['name', 'registeredModuleId', 'owner', 'ownerModuleId', 'ownerRuntimeGeneration', 'state', 'phase', 'reasonCode']), metadataRows(row.fallback, ['active', 'reasonCode'], { labels: { active: 'fallback', reasonCode: 'fallback 原因' } }))) : h('p', null, '不适用（无 Provider）'),
            h('h3', null, '依赖'), safeArray(health.dependencies).length ? health.dependencies.map(row => h('div', { key: row.moduleId }, metadataRows(row, ['moduleId', 'available']))) : h('p', null, '不适用（无依赖）'),
            h('h3', null, '调度计数'), metadataRows(health.scheduler, ['active', 'running', 'scheduled', 'fired', 'cancelled', 'completed', 'failed', 'nextDueAt']),
            h('h3', null, '引擎计数'), metadataRows(health.engine, ['runs', 'succeeded', 'failed', 'skipped', 'inFlight']),
            h('h3', null, '遥测'), metadataRows(health.telemetry, ['lastStartedAt', 'lastStoppedAt', 'lastSuccessAt', 'lastFailureAt', 'nextRunAt', 'inFlight', 'timerScheduled']),
          ),
        ) : null,
      )
    }
    async function readCoreApi(path) {
      const result = await get(path)
      if (result?.ok !== true) throw Error(result?.code || 'API_UNAVAILABLE')
      return result
    }
    async function pollModuleOperation(operation, { onOperation = () => {}, current = () => true, wait = () => new Promise(resolve => setTimeout(resolve, 750)) } = {}) {
      while (current()) {
        onOperation(operation)
        if (operationTerminal(operation)) return operation
        if (operation.id) await wait()
        if (!current()) return null
        const result = await readCoreApi('/modules/operation' + buildQuery(operation.id ? { id: operation.id } : { requestId: operation.requestId }))
        if (!current()) return null
        operation = result.operation
        if (!operation?.id) throw Error('MODULE_OPERATION_UNAVAILABLE')
      }
      return null
    }
    async function invokeModuleAction(moduleId, actionId, options = {}) {
      if (!Object.hasOwn(ACTION_LABELS, actionId)) throw Error('MODULE_ACTION_UNAVAILABLE')
      const catalog = options.catalog || await readCoreApi('/modules/actions?id=' + encodeURIComponent(moduleId))
      if (catalog.moduleId !== moduleId || !safeArray(catalog.items).some(row => row.actionId === actionId && row.available === true)) throw Error('MODULE_ACTION_UNAVAILABLE')
      const effects = actionId === 'proactivity.runOnce' ? '可能调用模型并向 QQ 发送消息，消耗预算。' : actionId === 'learning.runPending' ? '执行队列中到期任务，可能进行外部检索、调用模型并写入学习结果，消耗预算。' : '将改变模块生命周期及依赖模块；启用或恢复调度后可能调用模型或发送消息。'
      if (!window.confirm(ACTION_LABELS[actionId] + '？' + effects)) return null
      const body = { moduleId, actionId, expectedGeneration: catalog.expectedGeneration, requestId: globalThis.crypto.randomUUID() }
      for (const key of ['expectedPersonaId', 'expectedPersonaGeneration']) if (catalog[key] != null) body[key] = catalog[key]
      const pending = { requestId: body.requestId, status: 'queued', phase: 'admission' }
      options.onOperation?.(pending)
      let result
      try { result = await post('/modules/action', body) }
      catch { return pollModuleOperation(pending, options) }
      // The shared request helper turns transport/JSON errors into code-less failures.
      // Admission may have happened: recover by the original requestId, never resubmit.
      if (result?.ok !== true && !result?.code) return pollModuleOperation(pending, options)
      if (result?.ok !== true) {
        options.onOperation?.({ ...pending, status: 'failed', phase: 'done', code: result?.code || 'MODULE_ACTION_FAILED', result: { ok: false } })
        throw Error(result?.code || 'MODULE_ACTION_FAILED')
      }
      if (!result.operation?.id) throw Error('MODULE_OPERATION_UNAVAILABLE')
      return pollModuleOperation(result.operation, options)
    }
    function CoreModuleActions(props) {
      const api = useCogApi(props, '/modules/actions?id=' + encodeURIComponent(props.moduleId))
      const [operation, setOperation] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const guard = useRef({ active: true, busy: false })
      useEffect(() => { guard.current.active = true; return () => { guard.current.active = false } }, [])
      const run = async (actionId, resume = false) => {
        if (guard.current.busy) return
        guard.current.busy = true; setBusy(true); setError('')
        try {
          const options = { catalog: api.data, current: () => guard.current.active, onOperation: value => { if (guard.current.active) setOperation(value) } }
          const result = resume ? await pollModuleOperation(operation, options) : await invokeModuleAction(props.moduleId, actionId, options)
          if (!guard.current.active || !result) return
          if (operationSucceeded(result)) props.toast?.('动作完成', 'ok')
          else { setError(result.code || result.status); props.toast?.(result.code || '动作未成功', 'err') }
          await api.reload(); await props.onSettled?.()
        } catch (err) { if (guard.current.active) setError(String(err.message || '动作不可用')) }
        finally { guard.current.busy = false; if (guard.current.active) setBusy(false) }
      }
      const pending = busy || Boolean(operation && !operationTerminal(operation))
      const groups = [
        { id: 'lifecycle', label: '运行管理', description: '启停、重启或重载会影响本模块和依赖模块；恢复调度后可能调用模型或发送消息。', ids: ['module.enable', 'module.disable', 'module.restart', 'module.reload'] },
        { id: 'tasks', label: '手动任务', description: '手动执行可能调用模型、消耗预算、写入学习结果或向 QQ 发送消息，仍遵循现有闸门。', ids: ['proactivity.runOnce', 'learning.runPending'] },
      ]
      const effects = { 'module.enable': '恢复模块及符合条件的依赖调度。', 'module.disable': '停止模块并等待关联任务排空。', 'module.restart': '先停止再启动，运行中的任务会受影响。', 'module.reload': '重新读取外部代码与清单，并恢复符合条件的模块。', 'proactivity.runOnce': '尝试一次主动行为，可能向 QQ 发送消息。', 'learning.runPending': '执行到期待处理任务，可能检索、调用模型并写入结果。' }
      const content = h('div', { className: 'ob-stack ob-module-scope' },
        api.error || error ? h(Banner, { tone: 'err', message: error || api.error }) : null,
        groups.map(group => {
          const rows = safeArray(api.data?.items).filter(row => group.ids.includes(row.actionId) && (!props.actionIds || props.actionIds.includes(row.actionId)))
          if (!rows.length) return null
          const groupId = 'ob-module-actions-' + props.moduleId + '-' + group.id
          return h('section', { key: group.id, className: 'ob-module-action-group', role: 'group', 'aria-labelledby': groupId },
            h('h3', { id: groupId }, group.label), h('p', { className: 'ob-muted ob-small' }, group.description),
            h('div', { className: 'ob-module-actions' }, rows.map(row => {
              const reasonId = 'ob-module-action-' + props.moduleId + '-' + row.actionId + '-reason'
              const effectId = reasonId + '-effect'
              const disabledReason = !row.available ? ({ MODULE_ACTION_UNAVAILABLE: '此操作不适用于当前模块或状态（MODULE_ACTION_UNAVAILABLE）。', MODULE_ACTION_BUSY: '关联模块已有操作正在处理（MODULE_ACTION_BUSY）。', MODULE_KERNEL_DISPOSED: '插件正在停止，暂不能操作（MODULE_KERNEL_DISPOSED）。' })[row.reasonCode] || observedValue(row.reasonCode) : pending ? '已有操作正在处理中，请等待终态或继续观察。' : ''
              return h('div', { key: row.actionId, className: 'ob-module-action' },
                h(Btn, { small: true, kind: row.actionId === 'module.disable' ? 'danger' : 'secondary', 'aria-describedby': effectId + (disabledReason ? ' ' + reasonId : ''), disabled: pending || !row.available, onClick: () => run(row.actionId) }, ACTION_LABELS[row.actionId]),
                disabledReason ? h('p', { id: reasonId, className: 'ob-module-action-reason ob-small ob-muted' }, disabledReason) : null,
                h('p', { id: effectId, className: 'ob-small ob-muted' }, effects[row.actionId]),
              )
            })),
          )
        }),
        !api.data && !api.error ? h('p', { className: 'ob-small ob-muted' }, api.loading ? '正在读取可用操作…' : '暂无可用操作') : null,
        h('div', { className: 'ob-module-toolbar' }, h(Btn, { small: true, kind: 'ghost', disabled: busy, onClick: api.reload }, '刷新动作')),
        operation ? h('div', { role: 'status', 'aria-live': 'polite' },
          h('p', null, 'operation：' + operation.status + ' · ' + operation.phase + (operation.code ? ' · ' + operation.code : '')),
          operation.status === 'STOP_PENDING' ? h('p', null, 'STOP_PENDING：仍在排空，尚未完成；继续观察同一操作。') : null,
          !busy && !operationTerminal(operation) ? h(Btn, { small: true, onClick: () => run(null, true) }, '继续观察操作') : null,
        ) : null,
      )
      return props.compact ? content : h(Panel, { className: 'ob-module-scope', title: '模块操作', description: '可用性由核心检查，操作接纳后持续观察至完成；忙碌、跳过或失败不表示成功。' }, content)
    }
    function ModuleFeatureLinks(props) {
      if (!props.item.builtin || props.item.source !== 'builtin') return null
      return h('section', { 'aria-label': '功能入口', className: 'ob-module-actions' },
        safeArray(MODULE_DESTINATIONS[props.item.id]).map(link => h(Fragment, { key: link.label }, destinationButton(props, link.label, link.target))),
        destinationButton(props, '配置', { tab: 'modules', moduleId: props.item.id, anchor: 'config' }),
        destinationButton(props, '闭环', { tab: 'cognition', section: 'loop' }),
      )
    }
    function ReminderData(props) {
      const api = useCogApi(props, '/cognition/persona/data')
      const count = safeArray(api.data?.summary?.groups).find(row => row.id === 'reminders')
      return h(Panel, { title: '提醒数据', description: '当前人格的数据汇总；在对应 QQ 会话使用 /reminders 查询、/forgetreminder 取消。', actions: h(Btn, { small: true, onClick: api.reload }, '刷新提醒') },
        api.error ? h(Banner, { tone: 'err', message: api.error }) : null,
        h('p', null, '提醒记录：' + observedValue(count?.count)),
      )
    }
    function CogProactivity(props) {
      const api = useCogApi(props, '/cognition/proactivity')
      return h('div', { className: 'ob-stack' }, moduleBacklink(props, 'builtin-proactivity'),
        h(Panel, { title: '主动行为', description: '当前调度与引擎状态；手动执行仍遵循人格、暂停、安静时段、预算和出站闸门。', actions: h(Btn, { small: true, onClick: api.reload }, '刷新') },
          api.error ? h(Banner, { tone: 'err', message: api.error }) : null,
          metadataRows(api.data?.stats, ['active', 'running', 'lastTickAt', 'sent', 'skipped', 'dailyCount']),
          h(CoreModuleActions, { ...props, moduleId: 'builtin-proactivity', actionIds: ['proactivity.runOnce'], compact: true, onSettled: api.reload }),
        ), destinationButton(props, '查看闭环', { tab: 'cognition', section: 'loop' }),
      )
    }
    function loopStatus(value) {
      return ({ not_applicable: '不适用', not_observed: '未观察', unavailable: '不可用', interrupted: '已中断', running: '进行中', completed: '已完成', failed: '失败', sent: '已发送', partial: '部分发送', dry_run: '演练', empty: '空交付' })[value] || observedValue(value)
    }
    function LoopDetail(props) {
      const data = props.data, item = data?.item
      if (!item) return h('p', null, '详情不可用')
      const receipts = safeArray(data.receipts), feedback = safeArray(data.feedback), research = safeObject(data.research)
      const delivery = receipts.filter(row => row.kind === 'delivery')
      const researchApplicable = item.kind === 'research' || item.taskId || item.unknownId || safeArray(item.unknownRefs).length
      return h(Panel, { title: '闭环详情', description: '仅展示核心管理投影；缺少观测不代表执行成功。' },
        h('p', null, '闭环 ' + item.id + ' · ' + item.kind + ' · ' + loopStatus(item.status) + ' · ' + observedValue(item.reasonCode)),
        h('h3', null, '阶段'), h('ol', null, safeArray(item.stages).map((row, index) => h('li', { key: index }, row.stage + ' · ' + formatDateTime(row.at)))),
        h('h3', null, '交付回执'),
        delivery.length ? delivery.map(row => h('div', { key: row.id },
          h('p', null, loopStatus(row.status) + ' · ' + (row.data ? loopStatus(row.data.status) : '结果未观察') + ' · attemptedParts：' + observedValue(row.attemptedParts) + ' · sent parts：' + observedValue(row.data?.parts)),
          row.data ? h('p', null, 'failedPart：' + (['sent', 'dry_run', 'empty'].includes(row.data.status) ? '不适用' : observedValue(row.data.failedPart)) + ' · errorCode：' + observedValue(row.data.errorCode)) : null,
        )) : h('p', null, item.kind === 'research' ? '不适用' : '未观察（未保留交付回执）'),
        h('h3', null, '反馈与来源'),
        feedback.length ? feedback.map(row => h('div', { key: row.id }, metadataRows(row, ['source', 'attribution', 'attributionConfidence', 'reward']),
          h('p', null, 'policy committed：' + (row.policyUpdated === true ? '已提交' : row.policyUpdated === false ? '未提交' : '未观察')),
          h('p', null, 'policy before'), metadataRows(row.policyBefore, ['alpha', 'beta', 'trials', 'rewardSum']),
          h('p', null, 'policy after'), metadataRows(row.policyAfter, ['alpha', 'beta', 'trials', 'rewardSum']),
        )) : h('p', null, item.kind === 'research' ? '不适用' : '未观察'),
        receipts.filter(row => row.kind === 'feedback').map(row => h('div', { key: row.id }, '反馈回执 · ' + loopStatus(row.status) + ' · ' + observedValue(row.data?.source) + ' · ' + observedValue(row.data?.attribution) + ' · policy committed：' + observedValue(row.data?.policyUpdated), metadataRows(row.data, ['observation', 'attributionConfidence', 'reward']))),
        h('h3', null, '研究关联'), !researchApplicable ? h('p', null, '不适用') : h('div', null,
          metadataRows(research, ['taskCount', 'evidenceCount', 'claimCount', 'linksLimited']),
          ['unknowns', 'tasks', 'evidence', 'claims'].map(kind => h('div', { key: kind }, h('h4', null, kind), safeArray(research[kind]).length ? research[kind].map(row => h('div', { key: row.id },
            h('p', null, row.id + (row.status ? ' · ' + row.status : '')),
            destinationButton(props, kind === 'tasks' ? '查看学习任务' : '查看学习关联', { tab: 'cognition', section: 'learning', ...(row.taskId || kind === 'tasks' ? { taskId: row.taskId || row.id } : {}), anchor: kind === 'claims' ? 'claims' : kind === 'unknowns' ? 'unknowns' : 'tasks' }),
          )) : h('p', null, '未观察'))),
          receipts.filter(row => row.kind === 'research').map(row => h('div', { key: row.id }, h('p', null, '研究回执 · ' + loopStatus(row.status)), metadataRows(row.data, ['status', 'evidenceCount', 'errorCode']))),
        ),
        item.decisionId ? destinationButton(props, '查看决策', { tab: 'cognition', section: 'policy', decisionId: item.decisionId }) : null,
        item.moduleId ? moduleBacklink(props, item.moduleId) : null,
      )
    }
    function CogLoop(props) {
      const [view, setView] = useState(null)
      const [error, setError] = useState('')
      const [selected, setSelected] = useState(props.navigation?.decisionId ? { decisionId: props.navigation.decisionId } : null)
      const [before, setBefore] = useState('')
      const [loading, setLoading] = useState(false)
      const request = useRef(0)
      const selectedKey = JSON.stringify(selected)
      useEffect(() => { setSelected(props.navigation?.decisionId ? { decisionId: props.navigation.decisionId } : null); setBefore(''); setView(null) }, [props.navigation])
      const load = useCallback(async () => {
        const epoch = ++request.current
        setLoading(true); setError('')
        try {
          const summary = await readCoreApi('/system/loop/summary')
          const [runs, detail] = await Promise.all([
            readCoreApi('/system/loop/runs?limit=50' + (before ? '&before=' + encodeURIComponent(before) : '')),
            selected ? readCoreApi('/system/loop/detail' + buildQuery(selected)).catch(err => ({ error: String(err.message) })) : Promise.resolve(null),
          ])
          const current = await readCoreApi('/system/loop/summary')
          if (summary.personaId !== current.personaId || runs.items.some(row => row.personaId !== current.personaId) || (detail?.item && detail.item.personaId !== current.personaId)) throw Error('当前人格已变化，请刷新')
          if (epoch === request.current) setView({ summary: current, runs, detail: detail?.item ? detail : null, detailError: detail?.error || '' })
        } catch (err) { if (epoch === request.current) { setView(null); setError(String(err.message || 'LOOP_READ_UNAVAILABLE')) } }
        finally { if (epoch === request.current) setLoading(false) }
      }, [before, selectedKey])
      useEffect(() => { setView(null); load(); return () => { request.current++ } }, [load])
      const retained = view?.summary?.retained, business = view?.summary?.businessRecords
      return h('div', { className: 'ob-stack' },
        h(Panel, { title: '闭环', description: '当前人格；保留期内观测与业务记录分别统计。页面按需刷新，不展示原文、QQ 标识或事件标识。', actions: h(Btn, { small: true, disabled: loading, onClick: load }, '刷新闭环') },
          error ? h(Banner, { tone: 'err', message: '闭环不可用：' + error }) : null,
          loading ? h('p', null, '加载闭环…') : null,
          retained ? h(Fragment, null,
            metadataRows(retained, ['loops', 'receipts', 'attemptedDeliveries', 'attemptedParts', 'sentParts', 'sentPartsComplete', 'retentionMs', 'maxRecords']),
            h('h3', null, '运行状态'), metadataRows(retained.loopStates, ['running', 'completed', 'failed', 'interrupted']),
            h('h3', null, '阶段'), metadataRows(retained.stages, ['detected', 'decided', 'generating', 'delivering', 'observing', 'researching', 'closed']),
            h('h3', null, '交付状态'), metadataRows(retained.deliveryStates, ['sent', 'partial', 'failed', 'dry_run', 'empty']),
            h('h3', null, '观测覆盖'), metadataRows(retained.coverage, ['loopsWithDeliveryResult', 'loopsWithoutDeliveryResult', 'loopsWithFeedback', 'deliveryResultUnknown']),
            h('h3', null, '反馈 / policy committed'), metadataRows(retained.feedback, ['count', 'policyCommitted', 'rewardSum']),
            h('p', null, '反馈来源'), metadataRows(retained.feedback?.sources, ['incoming', 'reaction', 'manual', 'unknown']),
            h('p', null, '归因'), metadataRows(retained.feedback?.attribution, ['direct', 'heuristic', 'unobserved']),
            h('h3', null, '业务记录（独立于保留期）'), metadataRows(business, ['evidenceCount', 'outcomeCount', 'legacyProvenanceUnknown']),
            h('p', null, '学习任务状态'), metadataRows(business?.taskStates, ['pending', 'suggested', 'running', 'done', 'failed', 'cancelled']),
            h('p', null, '观测写入失败：' + observedValue(view.summary.processLifetime?.observationFailures)),
          ) : null,
        ),
        view ? h(Panel, { title: '闭环运行' },
          safeArray(view.runs.items).length ? view.runs.items.map(row => h('div', { key: row.id, className: 'ob-cog-card' },
            h('p', null, row.id + ' · ' + row.kind + ' · ' + loopStatus(row.status) + ' · ' + row.stage),
            h(Btn, { small: true, onClick: () => { setView(null); setSelected({ id: row.id }) } }, '查看详情'),
          )) : h('p', null, '未观察（当前保留期内没有运行）'),
          view.runs.nextBefore ? h(Btn, { small: true, onClick: () => { setView(null); setBefore(view.runs.nextBefore) } }, '下一页') : null,
          before ? h(Btn, { small: true, onClick: () => { setView(null); setBefore('') } }, '最新运行') : null,
        ) : null,
        view?.detailError ? h('p', { role: 'status' }, view.detailError === 'LOOP_NOT_FOUND' ? '详情未观察（当前人格保留期内无记录）' : '详情不可用：' + view.detailError) : null,
        view?.detail ? h(LoopDetail, { ...props, data: view.detail }) : null,
      )
    }

    function CognitionTab(props) {
      const [section, setSection] = useState(props.navigation?.section || (props.configTarget ? 'settings' : 'overview'))
      useEffect(() => {
        const next = props.navigation?.section || (props.configTarget ? 'settings' : 'overview')
        if (COG_SECTIONS.some(row => row.id === next)) setSection(next)
      }, [props.navigation, props.configTarget])
      useNavigationAnchor(props, 'ob-cog-')
      const overview = useCognitionOverview(props)
      const data = overview.data || {}
      const cfg = safeObject(props.configInfo && props.configInfo.config && props.configInfo.config.cognition)
      const footer = h(
        'div',
        { className: 'ob-cog-footer' },
        h(CogTag, { tone: data.ready ? 'ok' : 'err' }, data.ready ? '内核就绪' : '内核不可用'),
        data.paused ? h(CogTag, { tone: 'warn' }, '已暂停') : null,
        cfg.dryRun ? h(CogTag, { tone: 'info' }, '演练模式') : null,
        data.llm && data.llm.available ? h(CogTag, { tone: 'ok' }, 'LLM ' + (data.llm.route ? data.llm.route.provider + '/' + data.llm.route.model : '已连接')) : h(CogTag, { tone: 'warn' }, 'LLM 不可用'),
        h('span', { className: 'ob-muted ob-small' }, '数据目录：' + String(data.dbFile || '—')),
      )
      let page = null
      if (section === 'overview') page = h(CogOverview, { ...props, data, error: overview.error, loading: overview.loading, reload: overview.reload })
      else if (section === 'persona') page = h(CogPersona, props)
      else if (section === 'persons') page = h(CogPersons, { ...props, data })
      else if (section === 'relationships') page = h(CogRelationships, props)
      else if (section === 'memories') page = h(CogMemories, props)
      else if (section === 'timeline') page = h(CogTimeline, props)
      else if (section === 'emotion') page = h(CogEmotion, props)
      else if (section === 'purpose') page = h(CogPurpose, props)
      else if (section === 'policy') page = h(CogPolicy, props)
      else if (section === 'proactivity') page = h(CogProactivity, props)
      else if (section === 'loop') page = h(CogLoop, props)
      else if (section === 'learning') page = h(CogLearning, props)
      else if (section === 'skills') page = h(CogSkills, props)
      else if (section === 'meta') page = h(CogMeta, props)
      else page = h(CogSettings, props)
      return h(
        SettingsShell,
        {
          label: '认知分类',
          items: COG_SECTIONS,
          active: section,
          onSelect: setSection,
          footer,
        },
        page,
      )
    }

    function CogOverview(props) {
      const data = props.data || {}
      const counts = safeObject(data.counts)
      const persona = safeObject(data.persona)
      const emotion = safeObject(data.emotion)
      const metrics = safeObject(data.metrics)
      const llm = safeObject(data.llm)
      const direct = safeObject(llm.direct)
      const pipeline = safeObject(data.pipeline)
      const decisions = safeArray(data.recentDecisions)
      const unknowns = safeArray(data.recentUnknowns)
      return h(
        'div',
        { className: 'ob-stack', style: { gap: '16px' } },
        props.error ? h(Banner, { tone: 'err', message: '认知 API 不可用：' + props.error, actions: h(Btn, { small: true, kind: 'ghost', onClick: props.reload }, '重试') }) : null,
        h(
          'div',
          { className: 'ob-stat-grid' },
          h(StatTile, { label: '人物', value: Number(counts.person || 0), hint: '长期人物实体', icon: 'users', tone: 'brand' }),
          h(StatTile, { label: '关系', value: Number(counts.relationship || 0), hint: '多维有向作用域', icon: 'link', tone: 'brand' }),
          h(StatTile, { label: '记忆', value: Number(counts.memory || 0), hint: '情景/语义/程序', icon: 'memory', tone: 'brand' }),
          h(StatTile, { label: '未知缺口', value: Number(counts.unknown || 0), hint: '学习队列的输入', icon: 'alert', tone: 'warn' }),
          h(StatTile, { label: '决策', value: Number(counts.decision || 0), hint: '策略可追溯', icon: 'target', tone: 'brand' }),
          h(StatTile, { label: '技能', value: Number(counts.skill || 0), hint: '有效熟练度独立变化', icon: 'chart', tone: 'brand' }),
        ),
        h(
          'div',
          { className: 'ob-grid two' },
          h(
            Panel,
            { title: '当前状态', description: '模拟情绪与人格摘要；不声称主观体验。', actions: h('div', { className: 'ob-row' }, h(Btn, { small: true, kind: 'ghost', icon: 'sparkles', onClick: () => props.go && props.go('persona') }, '编辑人格'), h(Btn, { small: true, kind: 'ghost', icon: 'refresh', onClick: props.reload }, '刷新')) },
            h(
              'div',
              { className: 'ob-stack', style: { gap: '12px' } },
              h('div', { className: 'ob-row' }, h(CogTag, { tone: 'brand' }, '人格 v' + String(persona.version || 1)), persona.values ? safeArray(persona.values).slice(0, 4).map((value, index) => h(CogTag, { key: index, tone: 'muted' }, value)) : null),
              h(CogBar, { label: '开放/好奇', value: persona.openness }),
              h(CogBar, { label: '幽默', value: persona.humor }),
              h(CogBar, { label: '谨慎', value: persona.caution }),
              h('div', { className: 'ob-cog-divider' }),
              h('div', { className: 'ob-row' }, h(CogTag, { tone: emotion.valence >= 0 ? 'ok' : 'warn' }, '效价 ' + (Number(emotion.valence || 0).toFixed(2))), h(CogTag, { tone: 'muted' }, '唤醒 ' + Number(emotion.arousal || 0).toFixed(2)), h(CogTag, { tone: 'muted' }, '压力 ' + Number(emotion.stress || 0).toFixed(2))),
              h(CogBar, { label: '心境', value: (Number(emotion.mood || 0) + 1) / 2, text: Number(emotion.mood || 0).toFixed(2) }),
              safeArray(emotion.top).length ? h('p', { className: 'ob-field-help' }, '显著情绪：' + emotion.top.map((item) => item.emotion + ' ' + Math.round(Number(item.intensity || 0) * 100) + '%').join(' · ')) : h('p', { className: 'ob-field-help' }, '当前无明显离散情绪峰值'),
            ),
          ),
          h(
            Panel,
            { title: '模型与预算', description: 'LLM 只做语义分析与生成，不保存长期状态；直连协议在「模型」页管理。', actions: props.go ? h(Btn, { small: true, kind: 'ghost', onClick: () => props.go('models') }, '管理模型') : null },
            h(
              'div',
              { className: 'ob-stack', style: { gap: '8px' } },
              h(KV, { rows: [
                ['DSH', llm.dsh?.available ? '可用' : '不可用'],
                ['DSH 路由', llm.route ? String(llm.route.provider) + ' / ' + String(llm.route.model) : '—'],
                ['直连', direct.resolved ? String(direct.provider) + ' / ' + String(direct.model) : '未选择'],
                ['直连协议', direct.protocol || '—'],
                ['今日 token', String(Number(llm.usageToday || 0)) + ' / ' + String(Number(llm.budget || 0))],
                ['预算剩余', String(Number(llm.budgetLeft || 0))],
                ['检索模式', 'lexical + association'],
              ] }),
              llm.serviceWarning ? h('p', { className: 'ob-field-help' }, '诊断：' + llm.serviceWarning) : null,
            ),
          ),
        ),
        h(
          Panel,
          {
            title: '运行诊断',
            description: '最近一条消息发生了什么；群聊 gate 是否跳过、为什么。',
            actions: props.go ? h(Btn, { small: true, kind: 'ghost', icon: 'sparkles', onClick: () => props.go('persona') }, '调整群聊参与') : null,
          },
          h('div', { className: 'ob-stack', style: { gap: '8px' } },
            h('div', { className: 'ob-diagnostic-row' },
              h(CogTag, { tone: 'info' }, '群聊：' + (pipeline.groupMode === 'all' ? '所有消息' : pipeline.groupMode === 'probability' ? '按概率参与' : '仅 @/唤醒词')),
              h(CogTag, { tone: Number(pipeline.groupSkipped) ? 'warn' : 'muted' }, '跳过 ' + String(Number(pipeline.groupSkipped) || 0)),
              h(CogTag, { tone: Number(pipeline.decisions) ? 'ok' : 'muted' }, '决策 ' + String(Number(pipeline.decisions) || 0)),
              h(CogTag, { tone: Number(pipeline.sent) ? 'ok' : 'muted' }, '发送 ' + String(Number(pipeline.sent) || 0)),
            ),
            pipeline.lastTurn
              ? h('p', { className: 'ob-field-help', style: { margin: 0 } },
                  '最近：' + (pipeline.lastTurn.chatType === 'group' ? '群聊' : '私聊') +
                  (pipeline.lastTurn.addressed ? '（点名）' : '（未点名）') +
                  ' → ' + String(pipeline.lastTurn.outcome || '—') +
                  (pipeline.lastTurn.reason ? ' · ' + String(pipeline.lastTurn.reason) : ''),
                )
              : h('p', { className: 'ob-field-help', style: { margin: 0 } }, '还没有认知事件；收到消息后会在这里显示。'),
            pipeline.lastTurn && pipeline.lastTurn.outcome === 'skipped'
              ? h('p', { className: 'ob-field-help', style: { margin: 0, color: 'var(--ob-warn)' } }, '这条消息被群聊规则跳过；若希望 bot 参与，请到「人格 → 群聊参与」切换模式。')
              : null,
          ),
        ),
        h(
          'div',
          { className: 'ob-grid two' },
          h(
            Panel,
            { title: '最近决策', description: '候选动作、置信度与实际结果分离记录。' },
            decisions.length ? h('ul', { className: 'ob-list' }, decisions.slice(0, 8).map((item) =>
              h('li', { key: item.id, className: 'ob-list-item' },
                h('span', { className: 'ob-list-avatar' }, h(Icon, { name: 'target', size: 15 })),
                h('span', { className: 'ob-list-body' },
                  h('span', { className: 'ob-list-title' }, String(item.action || '—') + ' · ' + String(item.status || '—')),
                  h('span', { className: 'ob-list-sub' }, String(item.reason || item.contextKey || '')),
                ),
                h(Badge, { tone: item.status === 'sent' ? 'ok' : item.status === 'failed' ? 'err' : 'muted' }, String(item.status || '')),
              ),
            )) : h(CogEmpty, { title: '还没有决策', description: '收到消息并聚合后会在这里出现；演练模式也可观察。' }),
          ),
          h(
            Panel,
            { title: '未解决未知', description: '低置信/新概念/知识冲突会先记录，不编造。' },
            unknowns.length ? h('ul', { className: 'ob-list' }, unknowns.slice(0, 8).map((item) =>
              h('li', { key: item.id, className: 'ob-list-item' },
                h('span', { className: 'ob-list-avatar' }, h(Icon, { name: 'alert', size: 15 })),
                h('span', { className: 'ob-list-body' },
                  h('span', { className: 'ob-list-title' }, String(item.surface || '')),
                  h('span', { className: 'ob-list-sub' }, String(item.unknownType || '') + ' · ' + String(item.status || '')),
                ),
              ),
            )) : h(CogEmpty, { title: '暂无未知缺口', icon: 'check' }),
          ),
        ),
        h(
          Panel,
          { title: '控制', description: '暂停只停止认知决策；平台连接与原始日志保留。' },
          h(
            'div',
            { className: 'ob-row' },
            h(Btn, { small: true, kind: props.data?.paused ? 'primary' : 'ghost', icon: props.data?.paused ? 'play' : 'pause', onClick: async () => { const result = await cogPost(props, '/cognition/pause', { paused: !props.data?.paused }); if (result) { props.toast(result.paused ? '认知已暂停' : '认知已恢复', 'ok'); props.reload() } } }, props.data?.paused ? '恢复认知' : '暂停认知'),
            h(Btn, { small: true, kind: 'ghost', icon: 'refresh', onClick: props.reload }, '刷新'),
            h('span', { className: 'ob-small ob-muted' }, '深度学习任务可在「学习」页手动运行或重试。'),
          ),
        ),
      )
    }

    function CogPersona(props) {
      const [persona, setPersona] = useState(null)
      const [error, setError] = useState('')
      const [saving, setSaving] = useState(false)
      useEffect(() => {
        let alive = true
        ;(async () => {
          const parsed = parseApiResponse(await get('/cognition/persona'))
          if (!alive) return
          if (parsed.ok) setPersona(parsed.data.persona); else setError(parsed.message)
        })().catch((err) => { if (alive) setError(String(err.message || err)) })
        return () => { alive = false }
      }, [])
      const traits = safeObject(persona && persona.traits)
      const style = safeObject(persona && persona.style)
      const keys = [
        ['extraversion', '外向'], ['openness', '开放/好奇'], ['agreeableness', '宜人'], ['conscientiousness', '尽责'], ['emotionalSensitivity', '情绪敏感'], ['humor', '幽默'],
        ['socialInitiative', '社交主动'], ['caution', '谨慎'], ['expressiveness', '表达欲'], ['conflictApproach', '冲突倾向'], ['riskTolerance', '风险偏好'], ['consistency', '行为一致性'],
      ]
      const save = async (nextTraits, nextStyle) => {
        setSaving(true)
        const result = await cogPost(props, '/cognition/persona/edit', { traits: nextTraits || traits, style: nextStyle || style, reason: 'ui' })
        if (result) props.toast('人格已更新', 'ok')
        if (result && result.persona) setPersona(result.persona)
        setSaving(false)
      }
      if (!persona) return error ? h(Banner, { tone: 'err', message: error }) : h(CogLoading)
      return h(
        'div',
        { className: 'ob-stack', style: { gap: '14px' } },
        h(Banner, {
          tone: 'info',
          message: '这里只调数值人格；名字、身份、背景、性格描述、说话风格和群聊参与方式在顶层「人格」页。',
          actions: props.go ? h(Btn, { small: true, kind: 'ghost', onClick: () => props.go('persona') }, '去人格工作台') : null,
        }),
        h(Panel, { title: '稳定人格', description: '长期行为倾向；单次互动不改变。修改后立即持久化；锁定项不参与慢演化。', actions: h(Btn, { small: true, kind: 'ghost', icon: 'refresh', busy: saving, onClick: () => save(traits, style) }, '保存') },
          h('div', { className: 'ob-cog-sliders' }, keys.map(([key, label]) => h(
            'label',
            { key, className: 'ob-cog-slider' },
            h('span', { className: 'ob-cog-slider-head' }, h('span', null, label), h('span', { className: 'ob-muted' }, Number(traits[key] || 0).toFixed(2))),
            h('input', { type: 'range', min: 0.1, max: 0.9, step: 0.05, value: Number(traits[key] || 0.5), 'aria-label': label, onChange: (event) => { const value = Number(event.target.value); const next = Object.assign({}, traits, { [key]: value }); setPersona(Object.assign({}, persona, { traits: next })); save(next, style) } }),
          ))),
        ),
        h(Panel, { title: '表达风格', description: '风格参数只作为生成约束；不写死模板。' },
          h('div', { className: 'ob-cog-sliders' }, [['formality', '正式度'], ['verbosity', '话痨度'], ['emojiRate', 'emoji 倾向'], ['teasingBound', '调侃边界'], ['warmth', '温暖度']].map(([key, label]) => h(
            'label',
            { key, className: 'ob-cog-slider' },
            h('span', { className: 'ob-cog-slider-head' }, h('span', null, label), h('span', { className: 'ob-muted' }, Number(style[key] || 0).toFixed(2))),
            h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: Number(style[key] || 0), 'aria-label': label, onChange: (event) => { const value = Number(event.target.value); const next = Object.assign({}, style, { [key]: value }); setPersona(Object.assign({}, persona, { style: next })); save(traits, next) } }),
          ))),
        ),
        h(Panel, { title: '价值边界', description: '这些是行为边界，不是可被情绪/关系覆盖的硬安全规则。' },
          h('div', { className: 'ob-row' }, safeArray(persona.values).map((value, index) => h(CogTag, { key: index, tone: 'brand' }, value))),
          h('div', { className: 'ob-row', style: { marginTop: '10px' } },
            h(Btn, { small: true, kind: 'ghost', onClick: async () => { if (!window.confirm('恢复默认人格？会清除人格历史并重置为配置初值。')) return; const result = await cogPost(props, '/cognition/persona/reset', {}); if (result) { props.toast('人格已重置', 'ok'); setPersona(result.persona) } } }, '重置人格'),
          ),
        ),
        h(Panel, { title: '演化历史', description: '只记录缓慢演化与人工编辑；可追溯原因。' },
          safeArray(persona.history).slice(-10).reverse().map((item, index) => h('div', { key: index, className: 'ob-cog-history' }, h(CogTag, { tone: 'muted' }, String(new Date(item.at || Date.now()).toLocaleString())), h('span', { className: 'ob-small' }, String(item.reason || 'evolution') + (safeArray(item.changes).length ? ' · ' + item.changes.map((change) => change.key).join(', ') : '')))),
          (!Array.isArray(persona.history) || !persona.history.length) ? h(CogEmpty, { compact: true, title: '还没有演化记录' }) : null,
        ),
      )
    }

    function CogPersonFacet(props) {
      const { facet, personId, reload } = props
      const [draft, setDraft] = useState(null)
      const [saving, setSaving] = useState(false)
      const inFlight = useRef(false)
      const save = async () => {
        if (!draft || inFlight.current) return
        const length = Array.from(draft.value).length
        const confidence = Number(draft.confidence)
        if (length < 1 || length > 2000) { props.toast('画像内容须为 1–2000 个 Unicode 字符', 'err'); return }
        if (draft.confidence.trim() === '' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) { props.toast('置信度须为 0–1 的数字', 'err'); return }
        inFlight.current = true
        setSaving(true)
        try {
          const patch = { value: draft.value, confidence, actor: 'ui' }
          if (draft.status) patch.status = draft.status
          const result = await cogPost(props, '/cognition/person/correct-facet', { personId, facetId: facet.id, patch })
          if (result) { props.toast('画像项已更新', 'ok'); await reload(); setDraft(null) }
        } finally { inFlight.current = false; setSaving(false) }
      }
      return h('div', { className: 'ob-cog-facet' },
        h('div', { className: 'ob-row' }, h(CogTag, { tone: facet.evidenceKind === 'fact' ? 'ok' : facet.status === 'disputed' ? 'warn' : 'muted' }, facet.evidenceKind || facet.status), h(CogTag, { tone: 'muted' }, facet.facet), h('span', { className: 'ob-small ob-muted' }, facet.scopeType + (facet.scopeId ? ':' + facet.scopeId : '')), h('span', { className: 'ob-small ob-muted' }, '置信 ' + Number(facet.confidence || 0).toFixed(2))),
        h('p', { className: 'ob-small' }, String(facet.value || '')),
        draft ? h('div', { className: 'ob-stack', style: { gap: '8px' } },
          h('label', { className: 'ob-stack' }, '画像内容（1–2000 个 Unicode 字符）', h('textarea', { className: 'ob-textarea', rows: 4, 'aria-label': '画像内容', value: draft.value, disabled: saving, onChange: (event) => setDraft({ ...draft, value: event.target.value }) })),
          h('label', { className: 'ob-stack' }, '置信度（0–1）', h('input', { className: 'ob-input', type: 'number', min: 0, max: 1, step: 'any', 'aria-label': '画像置信度', value: draft.confidence, disabled: saving, onChange: (event) => setDraft({ ...draft, confidence: event.target.value }) })),
          h('label', { className: 'ob-stack' }, '状态', h('select', { className: 'ob-select', 'aria-label': '画像状态', value: draft.status, disabled: saving, onChange: (event) => setDraft({ ...draft, status: event.target.value }) },
            h('option', { value: '' }, '保留原状态（' + String(facet.status || 'active') + '）'), h('option', { value: 'active' }, 'active · 有效'), h('option', { value: 'disputed' }, 'disputed · 有争议'),
          )),
          h('div', { className: 'ob-row' }, h(Btn, { small: true, kind: 'primary', busy: saving, onClick: save }, '保存'), h(Btn, { small: true, kind: 'ghost', disabled: saving, onClick: () => setDraft(null) }, '取消')),
        ) : h(Btn, { small: true, kind: 'ghost', disabled: saving, onClick: () => setDraft({ value: String(facet.value || ''), confidence: String(facet.confidence ?? 0), status: ['active', 'disputed'].includes(facet.status) ? facet.status : '' }) }, '编辑'),
        h('div', { className: 'ob-row' }, h(Btn, { small: true, kind: 'ghost', icon: 'trash', disabled: saving, onClick: async () => {
          if (inFlight.current) return
          inFlight.current = true
          setSaving(true)
          try {
            const result = await cogPost(props, '/cognition/person/delete-facet', { personId, facetId: facet.id })
            if (result) { props.toast('画像项已删除', 'ok'); await reload() }
          } finally { inFlight.current = false; setSaving(false) }
        } }, '删除此项')),
      )
    }

    function CogPersons(props) {
      const [query, setQuery] = useState('')
      const [selected, setSelected] = useState('')
      const list = useCogApi(props, '/cognition/persons?limit=100')
      const detail = useCogApi(
        props,
        selected ? '/cognition/person?personId=' + encodeURIComponent(selected) : '',
        { auto: Boolean(selected) },
      )
      const persons = safeArray(list.data && list.data.items)
      const filtered = query ? persons.filter((item) => String(item.displayName || '').toLowerCase().includes(query.toLowerCase())) : persons
      return h(
        'div',
        { className: 'ob-stack', style: { gap: '14px' } },
        h(Panel, { title: '人物', description: '平台身份 ≠ 真实人物；画像每项带来源、置信度与作用域。', actions: h(Btn, { small: true, kind: 'ghost', icon: 'refresh', onClick: list.reload }, '刷新') },
          h(CogToolbar, null, h(CogSearch, { value: query, onChange: setQuery, placeholder: '搜索昵称/别名' })),
          list.error ? h(Banner, { tone: 'err', message: list.error }) : null,
          list.loading ? h(CogLoading) : filtered.length ? h('ul', { className: 'ob-list' }, filtered.map((person) =>
            h('li', { key: person.id, className: cx('ob-list-item', selected === person.id && 'on') },
              h('button', { type: 'button', className: 'ob-cog-person-select', onClick: () => setSelected(person.id) },
                h('span', { className: 'ob-list-avatar' }, h(Icon, { name: 'users', size: 15 })),
                h('span', { className: 'ob-list-body' }, h('span', { className: 'ob-list-title' }, String(person.displayName || '未命名')), h('span', { className: 'ob-list-sub' }, '画像项 ' + String(person.facetCount || 0) + ' · ' + safeArray(person.identities).length + ' 个身份')),
                h(Icon, { name: 'chevron', size: 14 }),
              ),
            ),
          )) : h(CogEmpty, { title: '还没有人物', description: '收到第一条 QQ 消息后会创建长期人物实体。' }),
        ),
        selected ? h(Panel, {
          title: '人物详情',
          description: '事实/自述/观察/推断/假设分开；可编辑当前人格的单条画像（含群印象），保留原作用域。',
          actions: h('div', { className: 'ob-row' },
            h(Btn, { small: true, kind: 'ghost', icon: 'copy', onClick: async () => { const parsed = parseApiResponse(await get('/cognition/export/person?personId=' + encodeURIComponent(selected))); if (!parsed.ok) { props.toast(parsed.message, 'err'); return } const blob = new Blob([JSON.stringify(parsed.data.data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'cognition-person.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) } }, '导出'),
            h(Btn, { small: true, kind: 'danger', icon: 'trash', onClick: async () => { if (!window.confirm('删除该人物的画像/关系/记忆？此操作不可撤销。')) return; const result = await cogPost(props, '/cognition/person/delete', { personId: selected }); if (result) { props.toast('人物数据已删除', 'ok'); setSelected(''); list.reload() } } }, '删除'),
          ),
        },
          detail.loading ? h(CogLoading) : detail.data?.person?.id === selected ? h('div', { className: 'ob-stack', style: { gap: '12px' } },
            h(KV, { rows: [['名称', String(detail.data.person?.displayName || '')], ['首次出现', String(new Date(detail.data.person?.firstSeen || Date.now()).toLocaleString())], ['身份数', String(safeArray(detail.data.identities).length)], ['画像项', String(safeArray(detail.data.facets).length)]] }),
            h('div', { className: 'ob-stack', style: { gap: '6px' } }, safeArray(detail.data.identities).map((identity, index) => h('div', { key: index, className: 'ob-cog-line' }, h(CogTag, { tone: 'muted' }, String(identity.platform || 'onebot')), h('span', null, String(identity.nickname || identity.platformUserId || '')), h('span', { className: 'ob-muted ob-small' }, 'confidence ' + Number(identity.confidence || 0).toFixed(2))))),
            h('div', { className: 'ob-cog-divider' }),
            safeArray(detail.data.facets).length ? safeArray(detail.data.facets).map((facet) => h(CogPersonFacet, { key: selected + ':' + facet.id, facet, personId: selected, toast: props.toast, reload: detail.reload })) : h(CogEmpty, { compact: true, title: '暂无画像项', description: '只有完整轮次才会更新长期画像。' }),
          ) : h(Banner, { tone: 'err', message: detail.error || '人物不存在' }),
        ) : h(CogEmpty, { title: '选择一个人物', description: '左侧列表来自认知库；私聊/群聊作用域不会互相泄漏。', icon: 'users' }),
      )
    }

    const COG_RELATIONSHIP_LABELS = { affinity: '好感', trust: '信任', respect: '尊重', comfort: '舒适', initiative: '主动', familiarity: '熟悉', intimacy: '亲密', conflict: '冲突', wariness: '戒备', stability: '稳定' }

    function CogRelationshipCard(props) {
      const { item, reload } = props
      const [draft, setDraft] = useState(null)
      const [saving, setSaving] = useState(false)
      const inFlight = useRef(false)
      const dimensions = Object.entries(safeObject(item.dimensions)).filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
      const changed = draft ? Object.entries(draft.values).filter(([key, value]) => value !== draft.original[key]) : []
      const save = async () => {
        if (!changed.length || inFlight.current) return
        if (changed.some(([, value]) => !Number.isFinite(value) || value < -1 || value > 1)) { props.toast('关系维度须为 -1–1 的数字', 'err'); return }
        inFlight.current = true
        setSaving(true)
        try {
          const patch = { scopeType: item.scopeType, scopeId: item.scopeId, ...Object.fromEntries(changed) }
          const result = await cogPost(props, '/cognition/relationship/adjust', { personId: item.personId, patch })
          if (result) { props.toast('关系已调整，历史已记录', 'ok'); await reload(); setDraft(null) }
        } finally { inFlight.current = false; setSaving(false) }
      }
      return h('div', { className: 'ob-cog-card' },
        h('div', { className: 'ob-spread' }, h('div', { className: 'ob-row' }, h('span', { className: 'ob-small' }, '人物 ' + String(item.personId)), h(CogTag, { tone: 'brand' }, String(item.scopeType || 'global') + (item.scopeId ? ':' + item.scopeId : '')), safeArray(item.summary).map((tag, index) => h(CogTag, { key: index, tone: 'muted' }, tag))), h('span', { className: 'ob-small ob-muted' }, '交互 ' + String(item.interactions || 0))),
        h('div', { className: 'ob-cog-bars' }, dimensions.map(([key, value]) => h(CogBar, { key, label: COG_RELATIONSHIP_LABELS[key] || key, value: (value + 1) / 2, text: value.toFixed(2) }))),
        draft ? h('div', { className: 'ob-stack', style: { gap: '8px', marginTop: '10px' } },
          h('p', { className: 'ob-field-help' }, '手动调整以 source=ui 保存并记录历史；只修改当前人物的此作用域，点击保存后生效。'),
          h('div', { className: 'ob-cog-sliders' }, dimensions.map(([key]) => h('label', { key, className: 'ob-cog-slider' },
            h('span', { className: 'ob-cog-slider-head' }, h('span', null, COG_RELATIONSHIP_LABELS[key] || key), h('span', { className: 'ob-muted' }, Number(draft.values[key]).toFixed(2))),
            h('input', { type: 'range', min: -1, max: 1, step: 0.01, 'aria-label': '调整关系 ' + key, value: draft.values[key], disabled: saving, onChange: (event) => setDraft({ ...draft, values: { ...draft.values, [key]: Number(event.target.value) } }) }),
          ))),
          h('div', { className: 'ob-row' }, h(Btn, { small: true, kind: 'primary', busy: saving, disabled: !changed.length, onClick: save }, '保存'), h(Btn, { small: true, kind: 'ghost', disabled: saving, onClick: () => setDraft(null) }, '取消')),
        ) : h(Btn, { small: true, kind: 'ghost', onClick: () => { const values = Object.fromEntries(dimensions); setDraft({ original: values, values: { ...values } }) } }, '调整'),
      )
    }

    function CogRelationships(props) {
      const rel = useCogApi(props, '/cognition/relationships')
      const items = safeArray(rel.data && rel.data.items)
      return h(
        'div',
        { className: 'ob-stack', style: { gap: '14px' } },
        h(Panel, { title: '社会关系', description: '多维、有向、情境化；不是单一好感度。历史可追溯。', actions: h(Btn, { small: true, kind: 'ghost', icon: 'refresh', onClick: rel.reload }, '刷新') },
          rel.error ? h(Banner, { tone: 'err', message: rel.error }) : null,
          rel.loading ? h(CogLoading) : items.length ? h('div', { className: 'ob-stack', style: { gap: '10px' } }, items.map((item) => h(CogRelationshipCard, { key: item.id, item, toast: props.toast, reload: rel.reload }))) : h(CogEmpty, { title: '还没有关系', description: '人物第一次互动后创建全局+当前场景关系。', icon: 'link' }),
        ),
      )
    }

    function CogMemories(props) {
      const [query, setQuery] = useState('')
      const [type, setType] = useState('')
      const [result, setResult] = useState(null)
      const [loading, setLoading] = useState(false)
      const [expanded, setExpanded] = useState('')
      const [archiveFile, setArchiveFile] = useState(null)
      const [importScope, setImportScope] = useState('global')
      const [importScopeId, setImportScopeId] = useState('')
      const [importing, setImporting] = useState(false)
      const [importResult, setImportResult] = useState(null)
      const [importError, setImportError] = useState('')
      const [importKind, setImportKind] = useState('memory')
      const search = useCallback(async (q = query, t = type) => {
        setLoading(true)
        const parsed = parseApiResponse(await get('/cognition/memories?query=' + encodeURIComponent(q || '') + '&type=' + encodeURIComponent(t || '') + '&limit=80'))
        setLoading(false)
        if (!parsed.ok) { props.toast(parsed.message, 'err'); return }
        setResult(parsed.data)
      }, [query, type, props])
      useEffect(() => { search('', '') }, [])
      const items = safeArray(result && result.items)
      const act = async (item, action) => {
        if (action === 'delete' && !window.confirm('彻底删除这条记忆？删除后不可恢复；「遗忘」只是降低检索权重。')) return
        const response = await cogPost(props, '/cognition/memory/action', { id: item.id, action })
        if (response) { props.toast(action === 'forget' ? '已遗忘（可重新激活）' : action === 'delete' ? '记忆已删除' : '记忆已激活', 'ok'); search() }
      }
      const importArchive = async () => {
        setImportError('')
        setImportResult(null)
        if (!archiveFile) { setImportError('请先选择 JSON/JSONL 文件'); return }
        if (archiveFile.size > 5 * 1024 * 1024) { setImportError('文件超过 5 MiB 上限'); return }
        if (importScope !== 'global' && !/^[0-9]+$/.test(importScopeId)) { setImportError('私聊/群 ID 必须是非空数字字符串'); return }
        setImporting(true)
        try {
          const content = await archiveFile.text()
          const parsed = parseApiResponse(await post('/cognition/import', { format: 'auto', kind: importKind, content, scopeType: importScope, scopeId: importScope === 'global' ? '' : importScopeId }))
          if (!parsed.ok) { setImportError(parsed.message); return }
          setImportResult(parsed.data)
          await search()
        } catch {
          setImportError('读取文件或导入失败，请检查文件及本地服务状态')
        } finally {
          setImporting(false)
        }
      }
      return h(
        'div',
        { className: 'ob-stack', style: { gap: '14px' } },
        h(Panel, { title: '记忆网络', description: '情景/语义/情绪/社交/程序记忆；检索按相关性、新近性、重要性、情绪与关联加权；遗忘≠删除。', actions: h('div', { className: 'ob-row' }, h(Btn, { small: true, kind: 'ghost', icon: 'refresh', onClick: () => search() }, '刷新'), h(Btn, { small: true, kind: 'ghost', icon: 'sparkles', onClick: async () => { if (!window.confirm('立即整理记忆并尝试阶段反思？会消耗少量 LLM 预算。')) return; const response = await cogPost(props, '/cognition/consolidation/run', { force: false }); if (response) { props.toast('整理完成：巩固 ' + String(response.consolidated || 0) + '，反思 ' + String(response.reflected || 0), 'ok'); search() } } }, '整理/反思')) },
          h(CogToolbar, null,
            h(CogSearch, { value: query, onChange: setQuery, onSubmit: () => search(), placeholder: '搜索记忆内容' }),
            h('select', { className: 'ob-select', value: type, onChange: (event) => { setType(event.target.value); search(query, event.target.value) }, 'aria-label': '记忆类型' },
              h('option', { value: '' }, '全部类型'),
              ['episodic', 'semantic', 'emotional', 'social', 'procedural', 'self'].map((value) => h('option', { key: value, value }, value)),
            ),
            h(Btn, { small: true, kind: 'ghost', icon: 'search', onClick: () => search() }, '检索'),
          ),
          loading ? h(CogLoading) : items.length ? h('div', { className: 'ob-stack', style: { gap: '8px' } }, items.map((item) =>
            h('div', { key: item.id, className: 'ob-cog-card' },
              h('div', { className: 'ob-spread' }, h('div', { className: 'ob-row' }, h(CogTag, { tone: item.type === 'semantic' ? 'brand' : 'muted' }, String(item.type || 'memory')), h(CogTag, { tone: 'muted' }, String(item.scopeType || 'global') + (item.scopeId ? ':' + item.scopeId : '')), h('span', { className: 'ob-small ob-muted' }, String(item.status || 'active'))), h('span', { className: 'ob-small ob-muted' }, '重要 ' + Number(item.importance || 0).toFixed(2) + ' · 访问 ' + String(item.accessCount || 0))),
              h('p', { className: 'ob-cog-memory-text' }, String(item.summary || item.content || '')),
              h('div', { className: 'ob-row' },
                h(Btn, { small: true, kind: 'ghost', onClick: () => setExpanded(expanded === item.id ? '' : item.id) }, expanded === item.id ? '收起' : '详情'),
                expanded === item.id ? h(Btn, { small: true, kind: 'ghost', onClick: () => act(item, 'activate') }, '激活') : null,
                expanded === item.id ? h(Btn, { small: true, kind: 'ghost', onClick: () => act(item, 'forget') }, '遗忘') : null,
                expanded === item.id ? h(Btn, { small: true, kind: 'danger', onClick: () => act(item, 'delete') }, '删除') : null,
              ),
              expanded === item.id ? h('div', { className: 'ob-cog-detail' }, h(KV, { rows: [['ID', item.id], ['创建', String(new Date(item.createdAt || Date.now()).toLocaleString())], ['来源', String((item.sourceEventIds || []).length) + ' 个事件'], ['置信', Number(item.confidence || 0).toFixed(2)], ['效价/唤醒', Number(item.valence || 0).toFixed(2) + ' / ' + Number(item.arousal || 0).toFixed(2)]] })) : null,
            ),
          )) : h(CogEmpty, { title: '没有匹配记忆', description: '记忆在完整轮次结束后写入；试试清空搜索或改变类型。', icon: 'memory' }),
        ),
        h(Panel, { title: '导入旧档案', description: '内容存入当前人格；导入幂等，相同作用域/人物/正文（时间轴还含时间）会跳过。仅支持 JSON/JSONL，不上传到外部服务。' },
          h('div', { className: 'ob-stack', style: { gap: '10px' } },
            h('select', { className: 'ob-select', value: importKind, disabled: importing, 'aria-label': '导入种类', onChange: (event) => { setImportKind(event.target.value); setImportResult(null); setImportError('') } },
              h('option', { value: 'memory' }, '记忆'),
              h('option', { value: 'timeline' }, '时间轴'),
            ),
            h('input', { type: 'file', accept: '.json,.jsonl,.txt', disabled: importing, 'aria-label': '旧档案文件', onChange: (event) => {
              const file = event.target.files?.[0] || null
              setImportResult(null)
              setImportError(file && file.size > 5 * 1024 * 1024 ? '文件超过 5 MiB 上限' : '')
              setArchiveFile(file && file.size <= 5 * 1024 * 1024 ? file : null)
            } }),
            h('div', { className: 'ob-row' },
              h('select', { className: 'ob-select', value: importScope, disabled: importing, 'aria-label': '导入作用域', onChange: (event) => { setImportScope(event.target.value); setImportScopeId('') } },
                h('option', { value: 'global' }, '全局'),
                h('option', { value: 'private' }, '当前人格私聊'),
                h('option', { value: 'group' }, '群'),
              ),
              importScope !== 'global' ? h('input', { className: 'ob-input', value: importScopeId, disabled: importing, inputMode: 'numeric', placeholder: importScope === 'private' ? '私聊 QQ 号' : '群号', 'aria-label': '导入作用域 ID', onChange: (event) => setImportScopeId(event.target.value) }) : null,
              h(Btn, { disabled: importing || !archiveFile, onClick: importArchive }, importing ? '导入中…' : '导入'),
            ),
            importError ? h(Banner, { tone: 'err', message: importError }) : null,
            importResult ? h('p', { role: 'status', className: 'ob-small' }, (importResult.kind === 'timeline' ? '时间轴' : '记忆') + '导入 ' + importResult.imported + ' · 跳过 ' + importResult.skipped + ' · 无效 ' + importResult.invalid + ' · 字节 ' + importResult.bytes) : null,
            h('p', { className: 'ob-field-help' }, '最多 5 MiB、5000 项（配置可调低）；档案内各项可指定作用域，未指定时使用上方选择。不会自动发送到 QQ。'),
          ),
        ),
      )
    }

    function CogEmotion(props) {
      const emo = useCogApi(props, '/cognition/emotion')
      const emotion = safeObject(emo.data && emo.data.emotion)
      const visible = safeObject(emo.data && emo.data.visible)
      const discrete = safeObject(emotion.discrete)
      const top = Object.entries(discrete).filter(([, value]) => Number(value) > 0.05).sort((a, b) => Number(b[1]) - Number(a[1]))
      return h(
        'div',
        { className: 'ob-stack', style: { gap: '14px' } },
        h(Panel, { title: '模拟情绪', description: 'OCC 评价 → PAD + 离散情绪；有惯性/衰减/调节。不是生物情绪或主观体验声明。', actions: h('div', { className: 'ob-row' }, h(Btn, { small: true, kind: 'ghost', icon: 'refresh', onClick: emo.reload }, '刷新'), h(Btn, { small: true, kind: 'ghost', onClick: async () => { if (!window.confirm('重置情绪状态？')) return; const result = await cogPost(props, '/cognition/emotion/reset', {}); if (result) { props.toast('情绪已重置', 'ok'); emo.reload() } } }, '重置')) },
          emo.error ? h(Banner, { tone: 'err', message: emo.error }) : null,
          h('div', { className: 'ob-stat-grid' },
            h(StatTile, { label: '效价', value: Number(emotion.valence || 0).toFixed(2), hint: '内部状态', icon: 'heart', tone: Number(emotion.valence || 0) >= 0 ? 'ok' : 'warn' }),
            h(StatTile, { label: '唤醒', value: Number(emotion.arousal || 0).toFixed(2), hint: '0–1', icon: 'bolt', tone: 'brand' }),
            h(StatTile, { label: '压力', value: Number(emotion.stress || 0).toFixed(2), hint: '影响有效技能', icon: 'alert', tone: 'warn' }),
            h(StatTile, { label: '心境', value: Number(emotion.moodValence || 0).toFixed(2), hint: '慢变量', icon: 'sun', tone: 'brand' }),
          ),
          h('div', { className: 'ob-cog-bars' },
            h(CogBar, { label: '内部效价', value: (Number(emotion.valence || 0) + 1) / 2, text: Number(emotion.valence || 0).toFixed(2) }),
            h(CogBar, { label: '可见效价（调节后）', value: (Number(visible.valence || 0) + 1) / 2, text: Number(visible.valence || 0).toFixed(2) }),
            h(CogBar, { label: '唤醒', value: Number(emotion.arousal || 0) }),
            h(CogBar, { label: '压力', value: Number(emotion.stress || 0) }),
            h(CogBar, { label: '疲劳', value: Number(emotion.fatigue || 0) }),
          ),
          h('div', { className: 'ob-cog-divider' }),
          h('div', { className: 'ob-row' }, top.length ? top.map(([key, value]) => h(CogTag, { key, tone: 'brand' }, key + ' ' + Math.round(Number(value) * 100) + '%')) : h('span', { className: 'ob-small ob-muted' }, '当前没有显著离散情绪')),
          emotion.appraisal ? h('p', { className: 'ob-field-help' }, '最近评价：' + JSON.stringify(emotion.appraisal)) : null,
        ),
      )
    }

    function CogTimeline(props) {
      const [type, setType] = useState('')
      const path = '/cognition/timeline?limit=120' + (type ? '&types=' + encodeURIComponent(type) : '')
      const api = useCogApi(props, path)
      const items = safeArray(api.data && api.data.items)
      const toneOf = (value) => value === 'turn' ? 'brand' : value === 'memory' ? 'ok' : value === 'event' ? 'warn' : 'muted'
      const timeOf = (at) => {
        const value = Number(at) || 0
        return value ? new Date(value).toLocaleString() : '—'
      }
      return h(
        'div',
        { className: 'ob-stack', style: { gap: '14px' } },
        h(Panel, {
          title: '时间轴',
          description: '轮次、记忆、决策、导入事件按时间合并；只读回忆日志，不改变任何状态。',
          actions: h('div', { className: 'ob-row' },
            h(Btn, { small: true, kind: 'ghost', icon: 'refresh', onClick: api.reload }, '刷新'),
          ),
        },
          h(CogToolbar, null,
            [['', '全部'], ['turn', '轮次'], ['memory', '记忆'], ['decision', '决策'], ['event', '事件']].map(([value, label]) =>
              h(Btn, { key: value || 'all', small: true, kind: type === value ? 'primary' : 'ghost', onClick: () => setType(value) }, label),
            ),
          ),
          api.error ? h(Banner, { tone: 'err', message: '时间轴 API 不可用：' + api.error }) : null,
          api.loading ? h(CogLoading) : items.length
            ? h('div', { className: 'ob-stack', style: { gap: '8px' } }, items.map((item) => h(
                'div',
                { key: item.id, className: 'ob-cog-line', style: { alignItems: 'flex-start' } },
                h('div', { className: 'ob-stack', style: { flex: 1, gap: '2px' } },
                  h('div', { className: 'ob-row' },
                    h(CogTag, { tone: toneOf(item.type) }, item.type),
                    h('strong', null, item.title || ''),
                    h('span', { className: 'ob-muted ob-small', style: { marginLeft: 'auto' } }, timeOf(item.at)),
                  ),
                  item.detail ? h('p', { className: 'ob-small', style: { margin: 0 } }, item.detail) : null,
                  h('span', { className: 'ob-muted ob-small' }, String(item.scopeType || 'global') + (item.scopeId ? ':' + item.scopeId : '')),
                ),
              )))
            : h(CogEmpty, { title: '暂无记录', description: '收到消息、形成记忆、产生决策或导入时间轴事件后会出现在这里。', icon: 'clock' }),
        ),
      )
    }

    function CogPurpose(props) {
      const list = useCogApi(props, '/cognition/purpose?limit=100')
      const items = safeArray(list.data && list.data.items)
      const stats = safeObject(list.data && list.data.stats)
      const [title, setTitle] = useState('')
      const [busy, setBusy] = useState(false)
      async function act(path, body, okText) {
        if (busy) return
        setBusy(true)
        const result = await cogPost(props, path, body)
        setBusy(false)
        if (result) {
          if (okText) props.toast(okText, 'ok')
          list.reload()
        }
      }
      const add = () => {
        const value = title.trim()
        if (!value) { props.toast('先填一个目的标题', 'warn'); return }
        act('/cognition/purpose/create', { title: value, type: 'goal', priority: 0.6, source: 'panel' }, '目的已创建')
        setTitle('')
      }
      const statusTone = (status) => status === 'active' ? 'ok' : status === 'done' ? 'brand' : status === 'paused' ? 'warn' : 'muted'
      return h(
        'div',
        { className: 'ob-stack', style: { gap: '14px' } },
        h(Panel, {
          title: '目的',
          description: '长期目标 / 计划 / 近期意图。只注入少量高优先级目的作为上下文，不自动执行工具；完成/放弃/暂停可随时调整。',
          actions: h('div', { className: 'ob-row' },
            h(Btn, { small: true, kind: 'ghost', icon: 'refresh', onClick: list.reload }, '刷新'),
          ),
        },
          h('div', { className: 'ob-row' },
            h('input', {
              className: 'ob-input',
              value: title,
              placeholder: '例如：学会做面包 / 这周整理一次记忆',
              'aria-label': '新目的标题',
              onChange: (event) => setTitle(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') add() },
            }),
            h(Btn, { small: true, kind: 'primary', icon: 'plus', disabled: busy, onClick: add }, '新建目的'),
          ),
          h('div', { className: 'ob-stat-grid' },
            h(StatTile, { label: '活跃', value: Number(stats.active || 0), icon: 'target', tone: 'brand' }),
            h(StatTile, { label: '已完成', value: Number((stats.byStatus && stats.byStatus.done) || 0), icon: 'check', tone: 'ok' }),
            h(StatTile, { label: '平均进度', value: CogPct(stats.averageProgress || 0), icon: 'chart', tone: 'muted' }),
          ),
          list.error ? h(Banner, { tone: 'err', message: '目的 API 不可用：' + list.error }) : null,
          list.loading ? h(CogLoading) : null,
          items.length
            ? h('div', { className: 'ob-stack', style: { gap: '10px' } }, items.map((item) => h(
                'div',
                { key: item.id, className: 'ob-stack', style: { gap: '6px', padding: '10px 0', borderTop: '1px solid var(--ob-border)' } },
                h('div', { className: 'ob-row' },
                  h(CogTag, { tone: 'muted' }, item.type || 'goal'),
                  h('strong', null, item.title || '(无标题)'),
                  h(CogTag, { tone: statusTone(item.status) }, item.status || 'active'),
                  h('span', { className: 'ob-muted ob-small', style: { marginLeft: 'auto' } }, '优先级 ' + Number(item.priority || 0).toFixed(2)),
                ),
                item.description ? h('p', { className: 'ob-field-help', style: { margin: 0 } }, item.description) : null,
                h(CogBar, { label: '进度', value: Number(item.progress || 0) }),
                h('div', { className: 'ob-row' },
                  h(Btn, { small: true, kind: 'ghost', disabled: busy, onClick: () => act('/cognition/purpose/update', { id: item.id, progress: Math.min(1, Number(item.progress || 0) + 0.1) }, '进度已更新') }, '+10%'),
                  item.status === 'paused'
                    ? h(Btn, { small: true, kind: 'ghost', disabled: busy, onClick: () => act('/cognition/purpose/update', { id: item.id, status: 'active' }, '已恢复') }, '恢复')
                    : h(Btn, { small: true, kind: 'ghost', disabled: busy, onClick: () => act('/cognition/purpose/update', { id: item.id, status: 'paused' }, '已暂停') }, '暂停'),
                  h(Btn, { small: true, kind: 'ghost', disabled: busy, onClick: () => act('/cognition/purpose/update', { id: item.id, status: 'done' }, '已完成') }, '完成'),
                  h(Btn, { small: true, kind: 'danger', disabled: busy, onClick: () => act('/cognition/purpose/update', { id: item.id, status: 'abandoned' }, '已放弃') }, '放弃'),
                ),
              )))
            : h(CogEmpty, { title: '还没有目的', description: '新建一个长期目标或近期计划；回复时只会在自然相关时体现。', icon: 'target' }),
        ),
      )
    }

    function CogPolicy(props) {
      const list = useCogApi(props, '/cognition/decisions?limit=100')
      const stats = safeObject(list.data && list.data.stats)
      const items = safeArray(list.data && list.data.items)
      useEffect(() => { if (props.navigation?.decisionId) document.getElementById('ob-cog-decision-' + props.navigation.decisionId)?.scrollIntoView?.() }, [props.navigation, list.data])
      const label = { reply: '回复', reply_short: '简短回复', clarify: '澄清', comfort: '关心', tease: '调侃', serious: '严肃', change_topic: '换话题', wait: '等待', silence: '沉默', learn: '学习', recall_tease: '撤回调侃', recall_concern: '撤回关心', recall_probe: '撤回试探', recall_silence: '假装没注意', recall_ignore: '忽略' }
      return h(
        'div',
        { className: 'ob-stack', style: { gap: '14px' } },
        h(Panel, { title: '策略与结果', description: '决策记录候选/效用/置信度；结果单独观察与归因；单次反馈不永久改变策略。', actions: h(Btn, { small: true, kind: 'ghost', icon: 'refresh', onClick: list.reload }, '刷新') },
          h('div', { className: 'ob-stat-grid' },
            h(StatTile, { label: '决策', value: Number(stats.total || 0), icon: 'target', tone: 'brand' }),
            h(StatTile, { label: '已发送', value: Number(stats.sent || 0), icon: 'send', tone: 'ok' }),
            h(StatTile, { label: '沉默', value: Number(stats.silent || 0), hint: '一等动作', icon: 'pause', tone: 'muted' }),
            h(StatTile, { label: '平均结果', value: Number(stats.averageReward || 0).toFixed(2), icon: 'chart', tone: 'brand' }),
            h(StatTile, { label: 'Brier', value: dataMetric(stats, 'brier'), hint: '越低越好', icon: 'target', tone: 'brand' }),
          ),
          props.navigation?.decisionId && !list.loading && !items.some(item => item.id === props.navigation.decisionId) ? h('p', { role: 'status' }, '当前决策列表未包含此目标；仅显示最近 100 条。') : null,
          list.error ? h(Banner, { tone: 'err', message: list.error }) : null,
          list.loading ? h(CogLoading) : items.length ? h('div', { className: 'ob-stack', style: { gap: '8px' } }, items.map((item) =>
            h('div', { key: item.id, id: 'ob-cog-decision-' + item.id, className: 'ob-cog-card', 'aria-current': props.navigation?.decisionId === item.id ? 'true' : undefined },
              h('div', { className: 'ob-spread' }, h('div', { className: 'ob-row' }, h(CogTag, { tone: item.action === 'silence' || item.action === 'wait' ? 'muted' : 'brand' }, label[item.action] || item.action), h(CogTag, { tone: 'muted' }, String(item.chatType || '') + (item.chatId ? ':' + item.chatId : '')), h('span', { className: 'ob-small ob-muted' }, '置信 ' + Number(item.confidence || 0).toFixed(2))), h(Badge, { tone: item.status === 'sent' ? 'ok' : item.status === 'failed' ? 'err' : 'muted' }, String(item.status || ''))),
              h('p', { className: 'ob-field-help', style: { margin: '2px 0 0' } }, String(item.reason || '')),
              destinationButton(props, '查看闭环', { tab: 'cognition', section: 'loop', decisionId: item.id }),
              h('div', { className: 'ob-row' }, h(Btn, { small: true, kind: 'ghost', onClick: async () => { const result = await cogPost(props, '/cognition/decision/correct', { decisionId: item.id, requestId: globalThis.crypto.randomUUID(), observation: { positiveReaction: true, attributionConfidence: 0.6 } }); if (result) { props.toast('已记录正向结果', 'ok'); list.reload() } } }, '标记正向'), h(Btn, { small: true, kind: 'ghost', onClick: async () => { const result = await cogPost(props, '/cognition/decision/correct', { decisionId: item.id, requestId: globalThis.crypto.randomUUID(), observation: { explicitCorrection: true, attributionConfidence: 0.7 } }); if (result) { props.toast('已记录负向结果', 'ok'); list.reload() } } }, '标记负向')),
            ),
          )) : h(CogEmpty, { title: '还没有决策', description: '聚合后的完整轮次会生成决策；沉默也会记录。', icon: 'target' }),
        ),
        h(Panel, { title: '学习到的策略', description: '按上下文 bucket 的 Beta 后验；可整体重置。' },
          h('div', { className: 'ob-row' }, h(Btn, { small: true, kind: 'ghost', onClick: async () => { if (!window.confirm('清空策略学习结果？历史决策保留。')) return; const result = await cogPost(props, '/cognition/policy/reset', {}); if (result) { props.toast('策略学习已重置', 'ok'); list.reload() } } }, '重置策略学习')),
          safeArray(stats.policies).length ? safeArray(stats.policies).slice(0, 12).map((item, index) => h('div', { key: index, className: 'ob-cog-line' }, h(CogTag, { tone: 'muted' }, String(item.action || '')), h('span', { className: 'ob-small' }, String(item.contextKey || '')), h('span', { className: 'ob-muted ob-small' }, 'α ' + Number(item.alpha || 0).toFixed(1) + ' / β ' + Number(item.beta || 0).toFixed(1) + ' · trials ' + String(item.trials || 0)))) : h(CogEmpty, { compact: true, title: '还没有策略后验', description: '获得结果反馈后会逐渐形成。' }),
        ),
      )
    }

    function dataMetric(stats, key) {
      const value = Number(stats && stats[key])
      return Number.isFinite(value) ? value.toFixed(2) : '—'
    }

    function CogLearning(props) {
      const unknowns = useCogApi(props, '/cognition/unknowns?limit=100')
      const tasks = useCogApi(props, '/cognition/learning/tasks?limit=100')
      const claims = useCogApi(props, '/cognition/claims?limit=100')
      const taskItems = safeArray(tasks.data?.items)
      const visibleTasks = (props.navigation?.taskId ? [...taskItems.filter(task => task.id === props.navigation.taskId), ...taskItems.filter(task => task.id !== props.navigation.taskId)] : taskItems).slice(0, 20)
      useNavigationAnchor(props, 'ob-cog-', !tasks.loading)
      useEffect(() => { if (props.navigation?.taskId) document.getElementById('ob-cog-task-' + props.navigation.taskId)?.scrollIntoView?.() }, [props.navigation, tasks.data])
      return h(
        'div',
        { className: 'ob-stack', style: { gap: '14px' } },
        moduleBacklink(props, 'builtin-learning'),
        destinationButton(props, '查看闭环', { tab: 'cognition', section: 'loop' }),
        props.navigation?.taskId ? h('p', { role: 'status' }, '定位学习任务：' + props.navigation.taskId + (safeArray(tasks.data?.items).some(task => task.id === props.navigation.taskId) ? '' : '（当前列表未包含；仅显示最近任务）')) : null,
        h(Panel, { title: '未知与学习', description: '未知检测不等于真正学习；外部资料多源验证后才形成带引用的 claim。', actions: h('div', { className: 'ob-row' }, h(Btn, { small: true, kind: 'ghost', icon: 'refresh', onClick: () => { unknowns.reload(); tasks.reload(); claims.reload() } }, '刷新'), h(CoreModuleActions, { ...props, moduleId: 'builtin-learning', actionIds: ['learning.runPending'], compact: true, onSettled: () => { tasks.reload(); unknowns.reload(); claims.reload() } })) },
          h('div', { className: 'ob-stat-grid' },
            h(StatTile, { label: '未知缺口', value: safeArray(unknowns.data && unknowns.data.items).length, icon: 'alert', tone: 'warn' }),
            h(StatTile, { label: '学习任务', value: safeArray(tasks.data && tasks.data.items).length, icon: 'book', tone: 'brand' }),
            h(StatTile, { label: '知识 claims', value: safeArray(claims.data && claims.data.items).length, icon: 'check', tone: 'ok' }),
          ),
          h(Panel, { id: 'ob-cog-unknowns', title: '未知列表', description: '没有证据时保持未知；不把猜测写成事实。' },
            safeArray(unknowns.data && unknowns.data.items).length ? h('ul', { className: 'ob-list' }, safeArray(unknowns.data.items).slice(0, 20).map((item) => h('li', { key: item.id, className: 'ob-list-item' }, h('span', { className: 'ob-list-avatar' }, h(Icon, { name: 'alert', size: 15 })), h('span', { className: 'ob-list-body' }, h('span', { className: 'ob-list-title' }, String(item.surface || '')), h('span', { className: 'ob-list-sub' }, String(item.unknownType || '') + ' · ' + String(item.status || '') + ' · 出现 ' + String(item.occurrences || 1))), h(CogTag, { tone: item.status === 'resolved' ? 'ok' : 'warn' }, String(item.status || ''))))) : h(CogEmpty, { title: '暂无未知', description: '低置信/新概念会出现。', icon: 'check' }),
          ),
          h(Panel, { id: 'ob-cog-tasks', title: '学习任务', description: '默认只检测未知；自动外部检索需在设置中显式开启。' },
            safeArray(tasks.data && tasks.data.items).length ? h('div', { className: 'ob-stack', style: { gap: '8px' } }, visibleTasks.map((task) => h('div', { key: task.id, id: 'ob-cog-task-' + task.id, className: 'ob-cog-card', 'aria-current': props.navigation?.taskId === task.id ? 'true' : undefined }, h('div', { className: 'ob-spread' }, h('div', { className: 'ob-row' }, h(CogTag, { tone: 'brand' }, String(task.surface || '')), h(CogTag, { tone: 'muted' }, String(task.status || ''))), h('span', { className: 'ob-small ob-muted' }, 'attempts ' + String(task.attempts || 0))), h('p', { className: 'ob-field-help', style: { margin: 0 } }, safeArray(task.plan).join(' ') || ''), h('div', { className: 'ob-row' }, h(Btn, { small: true, kind: 'ghost', onClick: async () => { const result = await cogPost(props, '/cognition/learning/task/retry', { taskId: task.id }); if (result?.task?.id === task.id && result.task.status === 'pending') { props.toast('已重试', 'ok'); tasks.reload() } else if (result) props.toast(result.task?.reason || '重试未成功', 'err') } }, '重试'), h(Btn, { small: true, kind: 'ghost', onClick: async () => { const result = await cogPost(props, '/cognition/learning/task/cancel', { taskId: task.id }); if (result?.task?.id === task.id && result.task.status === 'cancelled') { props.toast('已取消', 'ok'); tasks.reload() } else if (result) props.toast(result.task?.reason || '取消未成功', 'err') } }, '取消'))))) : h(CogEmpty, { title: '暂无学习任务', description: '开启自动研究或手动从未知创建任务。', icon: 'book' }),
          ),
          h(Panel, { id: 'ob-cog-claims', title: '知识 claims', description: '带来源、置信度与时效；冲突状态保留 disputed，不强行合并。' },
            safeArray(claims.data && claims.data.items).length ? safeArray(claims.data.items).slice(0, 20).map((claim) => h('div', { key: claim.id, className: 'ob-cog-card' }, h('div', { className: 'ob-row' }, h(CogTag, { tone: claim.status === 'disputed' ? 'warn' : 'ok' }, String(claim.concept || '')), h(CogTag, { tone: 'muted' }, String(claim.status || '')), h('span', { className: 'ob-small ob-muted' }, '置信 ' + Number(claim.confidence || 0).toFixed(2) + ' · 来源 ' + String(claim.sourceCount || 0))), h('p', { className: 'ob-small' }, String(claim.claim || '')), safeArray(claim.citations).length ? h('p', { className: 'ob-field-help' }, '引用：' + safeArray(claim.citations).map((citation) => citation.title || citation.url).join(' · ')) : null)) : h(CogEmpty, { title: '暂无 claims', description: '学习任务产生多源证据后才会写入。', icon: 'book' }),
          ),
        ),
      )
    }

    function CogSkills(props) {
      const list = useCogApi(props, '/cognition/skills')
      const items = safeArray(list.data && list.data.items)
      return h(Panel, { title: '技能', description: '独立于人格/情绪/关系；成功/失败/不用/压力都会改变有效熟练度。', actions: h(Btn, { small: true, kind: 'ghost', icon: 'refresh', onClick: list.reload }, '刷新') },
        list.error ? h(Banner, { tone: 'err', message: list.error }) : null,
        items.length ? h('div', { className: 'ob-stack', style: { gap: '10px' } }, items.map((skill) => h('div', { key: skill.id, className: 'ob-cog-card' }, h('div', { className: 'ob-spread' }, h('div', { className: 'ob-row' }, h(CogTag, { tone: 'brand' }, String(skill.label || skill.name)), h('span', { className: 'ob-small ob-muted' }, 'base ' + Number(skill.baseMastery || 0).toFixed(2))), h('span', { className: 'ob-small ob-muted' }, '使用 ' + String(skill.uses || 0) + ' · 成功 ' + String(skill.successes || 0) + ' · 失败 ' + String(skill.failures || 0))), h(CogBar, { label: '有效熟练度', value: Number(skill.effectiveMastery || 0) }), h('div', { className: 'ob-row' }, h(Btn, { small: true, kind: 'ghost', onClick: async () => { const result = await cogPost(props, '/cognition/skill/use', { name: skill.name, success: true }); if (result) { props.toast('已记录成功使用', 'ok'); list.reload() } } }, '记录成功'), h(Btn, { small: true, kind: 'ghost', onClick: async () => { const result = await cogPost(props, '/cognition/skill/use', { name: skill.name, success: false }); if (result) { props.toast('已记录失败', 'ok'); list.reload() } } }, '记录失败'))))) : h(CogEmpty, { title: '技能初始化中', icon: 'chart' }),
      )
    }

    function CogMeta(props) {
      const metrics = useCogApi(props, '/cognition/metrics')
      const insights = useCogApi(props, '/cognition/insights?limit=20')
      const m = safeObject(metrics.data && metrics.data.metrics)
      const items = safeArray(insights.data && insights.data.items)
      const gaps = safeArray(m.capabilityGaps)
      return h(
        'div',
        { className: 'ob-stack', style: { gap: '14px' } },
        h(Panel, { title: '自我评估', description: '校准、策略趋势、记忆/技能/学习健康；反思只产生 bounded insight，不修改代码或权限。', actions: h('div', { className: 'ob-row' }, h(Btn, { small: true, kind: 'ghost', icon: 'refresh', onClick: metrics.reload }, '刷新'), h(Btn, { small: true, kind: 'primary', icon: 'sparkles', onClick: async () => { const result = await cogPost(props, '/cognition/insights/generate', {}); if (result) { props.toast('已生成洞察', 'ok'); insights.reload() } } }, '生成洞察')) },
          h('div', { className: 'ob-stat-grid' },
            h(StatTile, { label: '决策', value: Number(m.decisions || 0), icon: 'target', tone: 'brand' }),
            h(StatTile, { label: '已观察结果', value: Number(m.observed || 0), icon: 'chart', tone: 'brand' }),
            h(StatTile, { label: '平均结果', value: Number(m.averageReward || 0).toFixed(2), icon: 'chart', tone: 'brand' }),
            h(StatTile, { label: 'Brier', value: m.brier == null ? '—' : Number(m.brier).toFixed(2), hint: '越低越校准', icon: 'target', tone: 'brand' }),
            h(StatTile, { label: '沉默率', value: m.silenceRate == null ? '—' : Math.round(Number(m.silenceRate) * 100) + '%', icon: 'pause', tone: 'muted' }),
            h(StatTile, { label: '未知缺口', value: Number(m.unknowns?.open || 0), icon: 'alert', tone: 'warn' }),
          ),
          h('div', { className: 'ob-cog-bars' },
            h(CogBar, { label: '记忆活跃', value: Number(m.memories?.active || 0) / Math.max(1, Number(m.memories?.total || 1)), text: String(m.memories?.active || 0) + '/' + String(m.memories?.total || 0) }),
            h(CogBar, { label: '技能平均', value: Number(m.skills?.average || 0) }),
          ),
          gaps.length ? h('div', { className: 'ob-row' }, gaps.map((gap, index) => h(CogTag, { key: index, tone: 'warn' }, gap.type + ' × ' + gap.count + ' → ' + gap.suggestion))) : null,
        ),
        h(Panel, { title: '近期洞察', description: '只记录结论与指标快照，可追溯；不是自我修改。' },
          items.length ? items.map((item, index) => h('div', { key: item.id || index, className: 'ob-cog-card' }, h('div', { className: 'ob-row' }, h(CogTag, { tone: 'muted' }, String(new Date(item.createdAt || Date.now()).toLocaleString()))), safeArray(item.insights).map((insight, idx) => h('p', { key: idx, className: 'ob-small', style: { margin: '3px 0' } }, '· ' + String(insight))))) : h(CogEmpty, { title: '还没有洞察', description: '运行一段时间或积累结果后生成。', icon: 'sparkles' }),
        ),
      )
    }

    function CogBudgetCard(props) {
      const api = useCogApi(props, '/cognition/llm/usage')
      const [resetting, setResetting] = useState(false)
      const resetLock = useRef(false)
      const data = api.data || {}
      const scopeLabels = { global: '全局', persona: '按人格', both: '两者取最小' }
      const busy = api.loading || resetting
      const reset = async (scope) => {
        if (busy || api.error || !api.data || Number(data[scope]?.usageToday || 0) <= 0 || resetLock.current) return
        const label = scope === 'global' ? '全局' : '当前人格'
        if (!window.confirm('重置' + label + '今日已用 token？不会修改预算、人格或配置。')) return
        resetLock.current = true
        setResetting(true)
        try {
          const result = await cogPost(props, '/cognition/llm/usage/reset', { confirm: true, scope })
          if (result) {
            props.toast('已重置' + label + '今日 LLM 用量', 'ok')
            await api.reload()
          }
        } finally {
          resetLock.current = false
          setResetting(false)
        }
      }
      const row = (scope, label, description) => {
        const counter = data[scope] || {}
        const usage = Math.max(0, Number(counter.usageToday) || 0)
        const budget = Math.max(0, Number(counter.budget) || 0)
        const progress = budget > 0 ? Math.min(1, usage / budget) : 1
        const enforced = data.scope === scope || data.scope === 'both'
        return h('div', { className: 'ob-stack', style: { gap: '8px' }, key: scope, role: 'group', 'aria-label': label + '今日预算' },
          h('div', { className: 'ob-row' }, h('strong', null, label), h(CogTag, null, enforced ? '参与约束' : '仅跟踪')),
          h('p', { className: 'ob-small ob-muted' }, description),
          h('div', { className: 'ob-stat-grid' },
            h(StatTile, { label: label + '今日已用 token', value: formatCount(usage) }),
            h(StatTile, { label: label + '每日预算 token', value: formatCount(budget) }),
            h(StatTile, { label: label + '剩余 token', value: formatCount(Math.max(0, Number(counter.budgetLeft) || 0)) }),
          ),
          h(CogBar, { label: label + '今日预算使用率', value: progress }),
          budget <= 0 || usage >= budget ? h(Banner, { tone: 'warn', message: label + '计数已达预算上限' + (enforced ? '，当前模式受此预算约束。' : '，当前模式仅跟踪此计数。') })
            : progress >= 0.8 ? h('p', { className: 'ob-small ob-muted', role: 'status' }, label + '预算已使用至少 80%，接近上限。') : null,
        )
      }
      return h(Panel, {
        title: '今日 LLM 预算',
        description: '分析（analysis）与回复（reply）计入两项用量；学习预算单独在 cog-learning 配置。',
        actions: h('div', { className: 'ob-row' },
          api.data ? h(CogTag, null, scopeLabels[data.scope] || '全局') : null,
          h(Btn, { small: true, kind: 'ghost', icon: 'refresh', disabled: busy, onClick: api.reload }, '刷新'),
          ...['global', 'persona'].map((scope) => h(Btn, {
            key: scope, small: true, kind: 'secondary', busy: resetting,
            disabled: busy || !!api.error || !api.data || Number(data[scope]?.usageToday || 0) <= 0,
            'aria-label': scope === 'global' ? '重置全局今日用量（所有人格共享）' : '重置当前人格今日用量',
            onClick: () => reset(scope),
          }, scope === 'global' ? '重置全局今日' : '重置当前人格今日')),
        ),
      },
        h('div', { className: 'ob-stack', 'aria-busy': busy, 'aria-live': 'polite', style: { gap: '12px' } },
          api.loading ? h('p', { className: 'ob-muted', role: 'status' }, '正在加载今日 LLM 用量…')
            : api.error ? h(Banner, { tone: 'err', message: api.error, actions: h(Btn, { small: true, kind: 'secondary', disabled: resetting, onClick: api.reload }, '重试') })
            : api.data ? h('div', { className: 'ob-stack', style: { gap: '12px' } },
              h('div', { className: 'ob-row' }, h(CogTag, null, String(data.date || '—') + ' UTC')),
              row('global', '全局', '所有人格共享此计数。'),
              row('persona', '当前人格', '仅当前人格：' + String(data.personaId || '—')),
              h(StatTile, { label: '当前模式有效剩余 token', value: formatCount(Math.max(0, Number(data.effectiveLeft) || 0)) }),
              data.exhausted ? h(Banner, { tone: 'warn', message: '今日 LLM 预算已耗尽；预算检查会阻止后续分析与回复模型调用。' }) : null,
            ) : h('p', { className: 'ob-muted' }, '暂无今日用量数据，请刷新。'),
        ),
      )
    }

    function CogSettings(props) {
      const groups = useMemo(() => systemFieldSpecs(props.configInfo && props.configInfo.groups).filter((group) => String(group.id).startsWith('cog-')), [props.configInfo])
      const [active, setActive] = useState(props.configTarget || (groups[0] ? groups[0].id : 'cog-core'))
      useEffect(() => { if (props.configTarget) setActive(props.configTarget) }, [props.navigation, props.configTarget])
      const current = groups.find((group) => group.id === active) || groups[0]
      if (!groups.length) return h(CogEmpty, { title: '认知设置不可用', description: '服务端未返回 cog-* 字段组；请检查插件版本。' })
      return h(SettingsShell, {
        label: '认知设置分类',
        items: groups.map((group) => ({ id: group.id, label: group.title, icon: configGroupIcon ? configGroupIcon(group.id) : 'sliders' })),
        active: current.id,
        onSelect: setActive,
        footer: props.prefStatus ? h(PreferenceSaveStatus, { status: props.prefStatus }) : null,
      },
        current.id === 'cog-llm' ? h(CogBudgetCard, props) : null,
        h(Panel, { title: current.title, description: current.description }, safeArray(current.fields).map((field) =>
          h(FieldRow, {
            key: field.path,
            spec: field,
            value: getByPath(props.draft || {}, field.path),
            onChange: (value) => { props.saveUiPatch({ [field.path]: value }) },
          }),
        )),
      )
    }
    // =====================================================================
    // 人格工作台：文本人设 + 群聊参与 + 高级认知参数
    // 顶层「人格」标签；与「认知」共享同一套 /cognition/persona API。
    // =====================================================================

    const PERSONA_PROFILE_FIELDS = [
      { key: 'displayName', label: '名字 / 自称', kind: 'input', max: 40, placeholder: '例如：小Q', help: '群聊里被叫到这个名字也会触发回应。' },
      { key: 'tagline', label: '一句话介绍', kind: 'input', max: 120, placeholder: '例如：在听，也在。' },
      { key: 'identity', label: '身份 / 角色', kind: 'input', max: 300, placeholder: '例如：群里的普通群友，喜欢音乐和猫。' },
      { key: 'background', label: '背景', kind: 'textarea', rows: 3, max: 1500, placeholder: '可写成长环境、经历、与群友的关系。' },
      { key: 'personality', label: '性格描述', kind: 'textarea', rows: 3, max: 1000, placeholder: '用自然语言描述性格；比滑杆更直接。' },
      { key: 'speakingStyle', label: '说话风格 / 口癖', kind: 'textarea', rows: 3, max: 800, placeholder: '例如：短句，偶尔吐槽，不用敬语。' },
      { key: 'examples', label: '示例对话（可选）', kind: 'textarea', rows: 3, max: 1500, placeholder: '示例：\n用户：今天好累。\n小Q：那就先歇会儿，别硬撑。' },
    ]
    const PERSONA_LIST_FIELDS = [
      { key: 'likes', label: '喜欢', placeholder: '每行一个，例如：猫\n音乐' },
      { key: 'dislikes', label: '不喜欢', placeholder: '每行一个' },
      { key: 'boundaries', label: '边界 / 禁忌', placeholder: '每行一个，例如：不编造事实\n不泄露私聊' },
    ]
    const PERSONA_TRAIT_LABELS = [
      ['extraversion', '外向'], ['openness', '开放/好奇'], ['agreeableness', '宜人'], ['conscientiousness', '尽责'],
      ['emotionalSensitivity', '情绪敏感'], ['humor', '幽默'], ['socialInitiative', '社交主动'], ['caution', '谨慎'],
      ['expressiveness', '表达欲'], ['conflictApproach', '冲突倾向'], ['riskTolerance', '风险偏好'], ['consistency', '行为一致性'],
    ]
    const PERSONA_STYLE_LABELS = [
      ['formality', '正式度'], ['verbosity', '话痨度'], ['emojiRate', 'emoji 倾向'],
      ['punctuation', '标点强度'], ['teasingBound', '调侃边界'], ['warmth', '温暖度'],
    ]
    const PERSONA_DATA_GROUPS = [
      { id: 'memory', label: '记忆' },
      { id: 'timeline', label: '时间轴事件' },
      { id: 'requests', label: '请求' },
      { id: 'reminders', label: '提醒' },
      { id: 'people', label: '人物画像' },
      { id: 'relationships', label: '关系' },
      { id: 'emotion', label: '情绪' },
      { id: 'policy', label: '策略与决策' },
      { id: 'learning', label: '信念与学习' },
      { id: 'skills', label: '技能' },
      { id: 'diagnostics', label: '诊断与元认知' },
    ]
    const GROUP_MODE_OPTIONS = [
      { value: 'addressed', label: '仅 @ / 回复 / 唤醒词' },
      { value: 'probability', label: '点名必回，未点名按概率' },
      { value: 'all', label: '所有群消息都分析（仍可沉默）' },
    ]

    function personaListText(value) {
      return safeArray(value).join('\n')
    }

    function parsePersonaList(text) {
      return String(text || '')
        .split(/[\n,，]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 20)
    }

    function personaProfileDraft(profile) {
      const source = safeObject(profile)
      const draft = {}
      for (const field of PERSONA_PROFILE_FIELDS) draft[field.key] = String(source[field.key] || '')
      const lists = {}
      for (const field of PERSONA_LIST_FIELDS) lists[field.key] = personaListText(source[field.key])
      return { profile: draft, lists }
    }

    function personaPreview(profile) {
      const lines = []
      const add = (label, value) => { if (String(value || '').trim()) lines.push(label + '：' + String(value).trim()) }
      add('名字/自称', profile.displayName)
      add('一句话介绍', profile.tagline)
      add('身份', profile.identity)
      add('背景', profile.background)
      add('性格', profile.personality)
      add('说话风格', profile.speakingStyle)
      add('喜欢', safeArray(profile.likes).join('、'))
      add('不喜欢', safeArray(profile.dislikes).join('、'))
      add('边界/禁忌', safeArray(profile.boundaries).join('、'))
      add('示例对话', profile.examples)
      const text = lines.join('\n')
      return [...text].length > 2000 ? [...text].slice(0, 1999).join('') + '…' : text
    }

    function PersonaField(props) {
      return h(
        'div',
        { className: 'ob-field' },
        h('div', { className: 'ob-field-label' }, h('span', null, props.label), props.optional ? h('span', { className: 'ob-muted' }, '可选') : null),
        h('div', { className: 'ob-field-control' }, props.children),
        props.help ? h('p', { className: 'ob-field-help' }, props.help) : null,
      )
    }

    function PersonaTab(props) {
      const [persona, setPersona] = useState(null)
      const [catalog, setCatalog] = useState([])
      const [activeId, setActiveId] = useState('')
      const [draft, setDraft] = useState(null)
      const [lists, setLists] = useState({})
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(true)
      const [saving, setSaving] = useState(false)
      const [dirty, setDirty] = useState(false)
      const [advanced, setAdvanced] = useState(false)
      const [behavior, setBehavior] = useState(null)
      const [behaviorStatus, setBehaviorStatus] = useState('')
      const [newOpen, setNewOpen] = useState(false)
      const [newName, setNewName] = useState('')
      const [personaBusy, setPersonaBusy] = useState('')
      const [dataCatalog, setDataCatalog] = useState([])
      const [dataSource, setDataSource] = useState('')
      const [dataGroups, setDataGroups] = useState(PERSONA_DATA_GROUPS.map((group) => group.id))
      const [dataBusy, setDataBusy] = useState(false)
      const [importOpen, setImportOpen] = useState(false)
      const [importBusy, setImportBusy] = useState(false)
      const [modelTest, setModelTest] = useState(null)
      const [modelTestBusy, setModelTestBusy] = useState(false)

      const syncFromPersona = useCallback((next) => {
        setPersona(next)
        const view = personaProfileDraft(next && next.profile)
        setDraft(view.profile)
        setLists(view.lists)
        setDirty(false)
      }, [])

      const applyPersonaPayload = useCallback((payload) => {
        const next = payload && (payload.persona || (payload.result && payload.result.persona))
        if (!next) return false
        syncFromPersona(next)
        if (Array.isArray(payload.personas)) setCatalog(payload.personas)
        if (payload.activeId) setActiveId(String(payload.activeId))
        else if (next.id) setActiveId(String(next.id))
        return true
      }, [syncFromPersona])

      const load = useCallback(async () => {
        try {
          const parsed = parseApiResponse(await get('/cognition/persona'))
          if (!parsed.ok) setError(parsed.message)
          else {
            applyPersonaPayload(parsed.data)
            setError('')
          }
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        } finally {
          setLoading(false)
        }
      }, [applyPersonaPayload])

      const loadData = useCallback(async () => {
        try {
          const parsed = parseApiResponse(await get('/cognition/persona/data?personaId=all'))
          if (parsed.ok && Array.isArray(parsed.data.items)) setDataCatalog(parsed.data.items)
        } catch (error) {}
      }, [])

      useEffect(() => { load(); loadData() }, [load, loadData])

      useEffect(() => {
        if (!dataSource || !dataCatalog.some((item) => item.id === dataSource)) {
          const next = dataCatalog.find((item) => !item.active)
          setDataSource(next ? next.id : '')
        }
      }, [dataCatalog, dataSource])

      const turnCfg = safeObject(props.configInfo && props.configInfo.config && props.configInfo.config.cognition && props.configInfo.config.cognition.turn)
      useEffect(() => {
        if (!props.configInfo) return
        setBehavior({
          groupReplyMode: turnCfg.groupReplyMode || 'addressed',
          groupReplyProbability: Number(turnCfg.groupReplyProbability ?? 0.2),
          groupCooldownMs: Number(turnCfg.groupCooldownMs ?? 3000),
          groupMaxRepliesPerMinute: Number(turnCfg.groupMaxRepliesPerMinute ?? 6),
        })
      }, [props.configInfo, turnCfg.groupReplyMode, turnCfg.groupReplyProbability, turnCfg.groupCooldownMs, turnCfg.groupMaxRepliesPerMinute])

      const change = (key, value) => {
        setDraft((previous) => Object.assign({}, previous, { [key]: value }))
        setDirty(true)
      }
      const changeList = (key, value) => {
        setLists((previous) => Object.assign({}, previous, { [key]: value }))
        setDirty(true)
      }

      const discardGuard = () => !dirty || window.confirm('当前人格有未保存修改，继续会丢弃这些修改。确定继续？')

      const switchTo = async (personaId) => {
        if (!personaId || personaId === activeId || !discardGuard()) return
        setPersonaBusy('switch')
        try {
          const result = await cogPost(props, '/cognition/persona/switch', { personaId })
          if (result) {
            applyPersonaPayload(result)
            loadData()
            props.toast && props.toast('已切换人格', 'ok')
          }
        } finally {
          setPersonaBusy('')
        }
      }

      const createPersona = async () => {
        if (!discardGuard()) return
        setPersonaBusy('create')
        try {
          const result = await cogPost(props, '/cognition/persona/create', {
            name: newName.trim(),
            activate: true,
          })
          if (result) {
            applyPersonaPayload(result)
            loadData()
            setNewOpen(false)
            setNewName('')
            props.toast && props.toast('已创建并切换到新人格', 'ok')
          }
        } finally {
          setPersonaBusy('')
        }
      }

      const duplicatePersona = async () => {
        if (!persona || !discardGuard()) return
        setPersonaBusy('duplicate')
        try {
          const result = await cogPost(props, '/cognition/persona/create', {
            copyFrom: persona.id,
            activate: true,
          })
          if (result) {
            applyPersonaPayload(result)
            loadData()
            props.toast && props.toast('已复制并切换人格', 'ok')
          }
        } finally {
          setPersonaBusy('')
        }
      }

      const deletePersona = async () => {
        if (!persona || catalog.length <= 1) return
        if (!window.confirm('删除当前人格？该人格的文本人设、数值和编辑历史会一起删除；至少保留一份。')) return
        setPersonaBusy('delete')
        try {
          const result = await cogPost(props, '/cognition/persona/delete', { personaId: persona.id })
          if (result) {
            applyPersonaPayload(result)
            loadData()
            props.toast && props.toast('人格已删除', 'ok')
          }
        } finally {
          setPersonaBusy('')
        }
      }

      const save = async () => {
        if (!persona || !draft || saving) return
        setSaving(true)
        try {
          const profile = Object.assign({}, draft, {
            likes: parsePersonaList(lists.likes),
            dislikes: parsePersonaList(lists.dislikes),
            boundaries: parsePersonaList(lists.boundaries),
          })
          const result = await cogPost(props, '/cognition/persona/edit', {
            personaId: persona.id,
            profile,
            traits: persona.traits,
            style: persona.style,
            values: persona.values,
            reason: 'ui',
          })
          const next = result && (result.result && result.result.persona ? result.result.persona : result.persona)
          if (next) {
            syncFromPersona(next)
            setCatalog((previous) => previous.map((item) => item.id === next.id
              ? Object.assign({}, item, { displayName: next.profile?.displayName || '', version: next.version, active: item.id === activeId })
              : item))
            props.toast && props.toast('人格已保存', 'ok')
          }
        } finally {
          setSaving(false)
        }
      }

      const reset = async () => {
        if (!persona) return
        if (!window.confirm('恢复当前人格的默认值？会清除该人格的编辑历史，不影响其他人格。')) return
        const result = await cogPost(props, '/cognition/persona/reset', { personaId: persona.id })
        if (result) {
          applyPersonaPayload(result)
          props.toast && props.toast('当前人格已重置', 'ok')
        }
      }

      const copyPersonaCognitiveData = async () => {
        const source = dataSource
        if (!persona || !source || source === persona.id || dataBusy) return
        if (!dataGroups.length) {
          props.toast && props.toast('至少选择一个数据组', 'warn')
          return
        }
        if (!window.confirm('将用来源人格的所选认知数据替换当前人格的对应数据组。此操作不可撤销，但不会影响来源人格。确定继续？')) return
        setDataBusy(true)
        try {
          const result = await cogPost(props, '/cognition/persona/data/copy', {
            from: source,
            to: persona.id,
            groups: dataGroups,
          })
          if (result) {
            await loadData()
            props.toast && props.toast('认知数据已复制到当前人格', 'ok')
          }
        } finally {
          setDataBusy(false)
        }
      }

      const importPersonaFile = async (event) => {
        const file = event.target.files && event.target.files[0]
        event.target.value = ''
        if (!file) return
        setImportBusy(true)
        try {
          const text = await file.text()
          const bundle = JSON.parse(text)
          const result = await cogPost(props, '/cognition/persona/import', bundle)
          if (result) {
            applyPersonaPayload(result)
            setImportOpen(false)
            await loadData()
            props.toast && props.toast('人格已导入并切换', 'ok')
          }
        } catch (error) {
          props.toast && props.toast('导入失败：' + String(error && error.message ? error.message : error), 'err')
        } finally {
          setImportBusy(false)
        }
      }

      const testModel = async () => {
        setModelTestBusy(true)
        try {
          const result = await cogPost(props, '/cognition/llm/test', { system: '你是模型链路测试。', user: '只回复 OK。' })
          setModelTest(result || { ok: false, error: 'REQUEST_FAILED', message: '请求失败' })
          if (result && result.ok) props.toast && props.toast('模型链路正常', 'ok')
        } catch (error) {
          setModelTest({ ok: false, error: 'REQUEST_FAILED', message: String(error && error.message ? error.message : error) })
        } finally {
          setModelTestBusy(false)
        }
      }

      const updateTrait = (key, value) => {
        setPersona((previous) => previous ? Object.assign({}, previous, { traits: Object.assign({}, previous.traits, { [key]: value }) }) : previous)
        setDirty(true)
      }
      const updateStyle = (key, value) => {
        setPersona((previous) => previous ? Object.assign({}, previous, { style: Object.assign({}, previous.style, { [key]: value }) }) : previous)
        setDirty(true)
      }

      const updateBehavior = async (key, value) => {
        const next = Object.assign({}, behavior || {}, { [key]: value })
        setBehavior(next)
        if (!props.saveConfigPatch) {
          setBehaviorStatus('配置接口不可用')
          return
        }
        setBehaviorStatus('保存中…')
        try {
          const saved = await props.saveConfigPatch({ cognition: { turn: { [key]: value } } })
          setBehaviorStatus(saved === false ? '保存失败' : '已保存')
          if (saved === false) props.toast && props.toast('群聊设置保存失败', 'err')
        } catch (err) {
          setBehaviorStatus('保存失败')
          props.toast && props.toast('群聊设置保存失败：' + String(err && err.message ? err.message : err), 'err')
        }
      }

      if (loading) return h(CogLoading)
      if (error || !persona || !draft) return h(Banner, { tone: 'err', message: error || '人格数据加载失败' })

      const profileForPreview = Object.assign({}, draft, {
        likes: parsePersonaList(lists.likes),
        dislikes: parsePersonaList(lists.dislikes),
        boundaries: parsePersonaList(lists.boundaries),
      })
      const preview = personaPreview(profileForPreview)
      const profile = safeObject(persona.profile)
      const displayName = draft.displayName || '未命名'
      const currentData = dataCatalog.find((item) => item.id === (activeId || persona.id)) || null
      const dataSources = dataCatalog.filter((item) => !item.active && item.id !== (activeId || persona.id))

      return h(
        'div',
        { className: 'ob-stack', style: { gap: '14px' } },
        h(Panel, {
          title: '人格库',
          description: '可以保存多份人格并随时切换；每份的文本人设、数值、历史完全独立。切换后下一轮消息即使用新人格。',
          actions: h('div', { className: 'ob-row' },
            h(Badge, { tone: 'muted' }, '共 ' + String(catalog.length || 1) + ' 份'),
          ),
        },
          h('div', { className: 'ob-row ob-persona-library' },
            h('label', { className: 'ob-field-label', htmlFor: 'ob-persona-select' }, '当前人格'),
            h('select', {
              id: 'ob-persona-select',
              className: 'ob-select ob-persona-select',
              value: activeId || (persona && persona.id) || '',
              disabled: Boolean(personaBusy) || catalog.length <= 1,
              onChange: (event) => switchTo(event.target.value),
            }, (catalog.length ? catalog : [{ id: persona && persona.id, displayName: displayName, version: persona && persona.version }]).map((item) => h(
              'option', { key: item.id, value: item.id },
              (item.displayName || '未命名人格') + (item.id === activeId ? '（当前）' : ''),
            ))),
            h(Btn, { small: true, kind: 'ghost', onClick: () => setNewOpen(!newOpen), disabled: personaBusy === 'switch' }, newOpen ? '收起' : '新建人格'),
            h(Btn, { small: true, kind: 'ghost', busy: personaBusy === 'duplicate', onClick: duplicatePersona, disabled: !persona }, '复制当前'),
            h(Btn, { small: true, kind: 'ghost', busy: personaBusy === 'delete', onClick: deletePersona, disabled: !persona || catalog.length <= 1 }, '删除当前'),
          ),
          h('p', { className: 'ob-field-help', style: { marginTop: '8px' } }, '切换后立即生效；未保存修改会先提示。'),
          newOpen ? h('div', { className: 'ob-persona-create' },
            h('input', {
              className: 'ob-input', type: 'text', value: newName, maxLength: 40, placeholder: '新人格名字，例如：温柔版 / 吐槽版',
              onChange: (event) => setNewName(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') createPersona() },
            }),
            h(Btn, { small: true, kind: 'primary', busy: personaBusy === 'create', onClick: createPersona }, '创建'),
            h(Btn, { small: true, kind: 'ghost', onClick: () => { setNewOpen(false); setNewName('') } }, '取消'),
          ) : null,
          h('div', { className: 'ob-persona-tools' },
            h(Btn, { small: true, kind: 'ghost', onClick: () => setImportOpen(!importOpen) }, importOpen ? '收起导入' : '导入人格 JSON'),
            importOpen ? h('input', {
              className: 'ob-input ob-persona-file', type: 'file', accept: '.json,application/json',
              disabled: importBusy, onChange: importPersonaFile,
            }) : null,
            h(Btn, { small: true, kind: 'ghost', busy: modelTestBusy, onClick: testModel }, '测试模型链路'),
            modelTest ? h('span', { className: modelTest.ok ? 'ob-small ob-oktext' : 'ob-small ob-errtext' },
              modelTest.ok
                ? '模型正常 · ' + String(modelTest.route?.provider || '') + '/' + String(modelTest.route?.model || '') + ' · ' + String(modelTest.latencyMs || 0) + 'ms'
                : '模型失败：' + String(modelTest.error || '') + ' · ' + String(modelTest.message || '')) : null,
          ),
          h('p', { className: 'ob-field-help', style: { marginTop: '8px' } }, '提示：人格库只保存人格本身；群聊参与方式仍是全局配置，不随人格切换。'),
        ),
        h(Panel, {
          title: '认知数据',
          description: '记忆、人物、关系、情绪、策略、学习与技能按当前人格独立保存；切换人格就是切换整套认知状态。',
          actions: h(Badge, { tone: 'muted' }, '共 ' + String(currentData?.total ?? 0) + ' 条'),
        },
          h('div', { className: 'ob-row ob-persona-data-chips' },
            (currentData?.groups || []).map((group) => h(CogTag, { key: group.id, tone: group.count ? 'brand' : 'muted' },
              group.label + ' ' + String(group.count || 0))),
          ),
          h('p', { className: 'ob-field-help' }, '复制是单向的：用来源人格的所选数据替换当前人格的对应组；来源人格不变，复制后两者继续独立。'),
          dataSources.length ? h('div', { className: 'ob-persona-data-copy' },
            h('label', { className: 'ob-field-label', htmlFor: 'ob-data-source' }, '来源人格'),
            h('select', {
              id: 'ob-data-source', className: 'ob-select',
              value: dataSource, onChange: (event) => setDataSource(event.target.value),
            }, dataSources.map((item) => h('option', { key: item.id, value: item.id }, item.displayName || '未命名人格'))),
            h('div', { className: 'ob-persona-data-groups' }, PERSONA_DATA_GROUPS.map((group) => h('label', { key: group.id, className: 'ob-check' },
              h('input', {
                type: 'checkbox', checked: dataGroups.includes(group.id),
                onChange: (event) => setDataGroups((previous) => event.target.checked
                  ? [...new Set([...previous, group.id])]
                  : previous.filter((id) => id !== group.id)),
              }),
              group.label,
            ))),
            h(Btn, { small: true, kind: 'secondary', busy: dataBusy, onClick: copyPersonaCognitiveData, disabled: !dataSource }, '复制到当前人格'),
          ) : h('p', { className: 'ob-field-help' }, '先新建或复制一份其他人格，才能做认知数据复制。'),
        ),
        (!props.ownerIntegration || props.runtimeEditor) && h(Panel, {
          title: '人格',
          description: '这些是长期、稳定的设定；保存后进入每次分析与回复的 prompt。群聊消息仍是不可信外部数据。',
          actions: h('div', { className: 'ob-row' },
            dirty ? h(Badge, { tone: 'warn' }, '有未保存修改') : null,
            h(Btn, { small: true, kind: 'primary', busy: saving, onClick: save }, dirty ? '保存人格' : '保存'),
            h(Btn, { small: true, kind: 'ghost', onClick: reset }, '恢复默认'),
          ),
        },
          h('div', { className: 'ob-row', style: { marginBottom: '8px' } },
            h(CogTag, { tone: 'brand' }, displayName),
            h(CogTag, { tone: 'muted' }, '人格 v' + String(persona.version || 1)),
            profileForPreview.tagline ? h('span', { className: 'ob-muted' }, profileForPreview.tagline) : null,
          ),
          h('div', { className: 'ob-grid two' }, PERSONA_PROFILE_FIELDS.slice(0, 3).map((field) => h(
            PersonaField,
            { key: field.key, label: field.label, help: field.help, optional: field.key === 'tagline' },
            h('input', {
              className: 'ob-input', type: 'text', value: draft[field.key] || '', maxLength: field.max, placeholder: field.placeholder,
              onChange: (event) => change(field.key, event.target.value),
            }),
          ))),
          h('div', { className: 'ob-grid two' }, PERSONA_PROFILE_FIELDS.slice(3).map((field) => h(
            PersonaField,
            { key: field.key, label: field.label, optional: field.key === 'background' || field.key === 'examples' },
            h('textarea', {
              className: 'ob-textarea', rows: field.rows || 3, value: draft[field.key] || '', maxLength: field.max, placeholder: field.placeholder,
              onChange: (event) => change(field.key, event.target.value),
            }),
          ))),
          h('div', { className: 'ob-grid two' }, PERSONA_LIST_FIELDS.map((field) => h(
            PersonaField,
            { key: field.key, label: field.label, help: '每行一个，最多 20 条。', optional: true },
            h('textarea', {
              className: 'ob-textarea', rows: 3, value: lists[field.key] || '', placeholder: field.placeholder,
              onChange: (event) => changeList(field.key, event.target.value),
            }),
          ))),
          h('div', { className: 'ob-row', style: { marginTop: '8px' } },
            h(CogTag, { tone: 'muted' }, '边界会作为硬性表达约束，不覆盖安全与隐私规则'),
          ),
        ),
        (!props.ownerIntegration || props.runtimeEditor) && h(Panel, {
          title: 'Prompt 预览',
          description: '实际注入 compose system 的人设块（截断到 2000 字符）；空字段不会出现。',
        },
          preview
            ? h('pre', { className: 'ob-persona-prompt' }, preview)
            : h(CogEmpty, { compact: true, title: '还没有填写人设', description: '填名字、性格或说话风格后，这里会显示将注入的内容。' }),
        ),
        !props.ownerIntegration && h(Panel, {
          title: '群聊参与',
          description: '默认仅 @/回复/唤醒词。想让 bot 在群里更像普通聊天机器人，可切到“所有消息”或“按概率”。',
          actions: behaviorStatus ? h('span', { className: 'ob-muted ob-small' }, behaviorStatus) : null,
        },
          behavior ? h('div', null,
            h(PersonaField, { label: '回应方式', help: '所有消息模式仍受策略沉默、冷却和每分钟上限约束。' },
              h('select', {
                className: 'ob-select', value: behavior.groupReplyMode,
                onChange: (event) => updateBehavior('groupReplyMode', event.target.value),
              }, GROUP_MODE_OPTIONS.map((option) => h('option', { key: option.value, value: option.value }, option.label))),
            ),
            behavior.groupReplyMode === 'probability' ? h(PersonaField, { label: '未点名参与概率', help: '0–1；点名消息不受这个概率影响。' },
              h('input', {
                className: 'ob-input', type: 'number', min: 0, max: 1, step: 0.05, value: behavior.groupReplyProbability,
                onChange: (event) => updateBehavior('groupReplyProbability', Number(event.target.value)),
              }),
            ) : null,
            h('div', { className: 'ob-grid two' },
              h(PersonaField, { label: '同群回复冷却', help: '单位毫秒；只影响未点名消息。' },
                h('input', {
                  className: 'ob-input', type: 'number', min: 0, max: 60000, step: 500, value: behavior.groupCooldownMs,
                  onChange: (event) => updateBehavior('groupCooldownMs', Number(event.target.value)),
                }),
              ),
              h(PersonaField, { label: '群聊每分钟上限', help: '全局滑动窗口，防刷屏。' },
                h('input', {
                  className: 'ob-input', type: 'number', min: 1, max: 60, step: 1, value: behavior.groupMaxRepliesPerMinute,
                  onChange: (event) => updateBehavior('groupMaxRepliesPerMinute', Number(event.target.value)),
                }),
              ),
            ),
            h('p', { className: 'ob-field-help' }, '提示：当前状态会在「认知 → 状态」的运行诊断里显示；如果仍然不回复，先看最近一条消息是否被群聊 gate 跳过。'),
          ) : h(CogLoading),
        ),
        (!props.ownerIntegration || props.runtimeEditor) && h(Panel, {
          title: '高级认知参数',
          description: '数值会参与策略和表达；普通使用只需要上面的文本人设。',
          actions: h(Btn, { small: true, kind: 'ghost', icon: 'chevron', onClick: () => setAdvanced(!advanced) }, advanced ? '收起' : '展开'),
        },
          advanced ? h('div', null,
            h('h4', { className: 'ob-persona-subtitle' }, '稳定特质'),
            h('div', { className: 'ob-grid two' }, PERSONA_TRAIT_LABELS.map(([key, label]) => h(PersonaField, { key, label: label + ' · ' + Number(persona.traits && persona.traits[key] || 0).toFixed(2) },
              h('input', {
                type: 'range', min: 0.1, max: 0.9, step: 0.05, value: Number(persona.traits && persona.traits[key] || 0.5),
                'aria-label': label,
                onChange: (event) => updateTrait(key, Number(event.target.value)),
              }),
            ))),
            h('h4', { className: 'ob-persona-subtitle' }, '表达风格'),
            h('div', { className: 'ob-grid two' }, PERSONA_STYLE_LABELS.map(([key, label]) => h(PersonaField, { key, label: label + ' · ' + Number(persona.style && persona.style[key] || 0).toFixed(2) },
              h('input', {
                type: 'range', min: 0, max: 1, step: 0.05, value: Number(persona.style && persona.style[key] || 0),
                'aria-label': label,
                onChange: (event) => updateStyle(key, Number(event.target.value)),
              }),
            ))),
          ) : h('p', { className: 'ob-muted ob-small' }, '展开后可微调 12 维人格和 6 维表达风格；保存仍使用上方按钮。'),
        ),
        (!props.ownerIntegration || props.runtimeEditor) && h(Panel, { title: '演化历史', description: '记录人工编辑与长期慢演化；可追溯原因。' },
          safeArray(persona.history).slice(-10).reverse().map((item, index) => h('div', { key: index, className: 'ob-cog-history' },
            h(CogTag, { tone: 'muted' }, String(new Date(item.at || Date.now()).toLocaleString())),
            h('span', { className: 'ob-small' }, String(item.reason || 'evolution') + (safeArray(item.changes).length ? ' · ' + item.changes.map((change) => change.key).join(', ') : '')),
          )),
          (!Array.isArray(persona.history) || !persona.history.length) ? h(CogEmpty, { compact: true, title: '还没有编辑记录' }) : null,
        ),
      )
    }
    function MediaPage(props) {
      const [mediaStatus, setMediaStatus] = useState(null)
      const [items, setItems] = useState([])
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState('')
      const [ttsText, setTtsText] = useState('')
      const [ttsFile, setTtsFile] = useState('')
      const [imagePrompt, setImagePrompt] = useState('')
      const [imageSize, setImageSize] = useState('1024x1024')
      const [imageSource, setImageSource] = useState('')
      const [imageResult, setImageResult] = useState('')
      const [imageError, setImageError] = useState('')
      const [busy, setBusy] = useState('')
      const [filesData, setFilesData] = useState({ items: [], totalBytes: 0 })
      const [filesError, setFilesError] = useState('')
      const [filesLoading, setFilesLoading] = useState(false)
      const fileBusy = useRef(false)
      const fileAccept = '.txt,.md,.json,.csv,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.7z,.rar'

      const refreshFiles = useCallback(async () => {
        setFilesLoading(true)
        try {
          const result = safeObject(await get('/media/files'))
          if (result.ok === false) {
            setFilesData({ items: [], totalBytes: 0 })
            setFilesError(String(result.message || '文件列表加载失败'))
          } else {
            setFilesData(result)
            setFilesError('')
          }
        } catch { setFilesError('文件列表加载失败') }
        finally { setFilesLoading(false) }
      }, [])

      const refresh = useCallback(async () => {
        setLoading(true)
        setError('')
        try {
          const [statusResponse] = await Promise.all([get('/media/status'), refreshFiles()])
          const statusResult = safeObject(statusResponse)
          setMediaStatus(statusResult)
          setItems([])
          if (statusResult.ok === false) setError(String(statusResult.message || '媒体数据加载失败'))
          else if (statusResult.stickers?.libraryAvailable === true) {
            const stickerResult = safeObject(await get('/media/stickers?limit=200'))
            if (stickerResult.ok === false) setError(String(stickerResult.message || '表情包加载失败'))
            else setItems(safeArray(stickerResult.items))
          }
        } catch { setError('媒体数据加载失败') }
        setLoading(false)
      }, [refreshFiles])

      useEffect(() => { refresh() }, [refresh])

      const runTts = async () => {
        const text = ttsText.trim()
        if (!text) return props.toast('请先输入测试文本', 'warn')
        setBusy('tts')
        const result = safeObject(await post('/media/tts', { text }))
        setBusy('')
        if (!result.ok) return props.toast('TTS 测试失败：' + String(result.message || '未知错误'), 'err')
        setTtsFile(String(result.file || ''))
        props.toast('TTS 文件已生成', 'ok')
      }

      const runImage = async (kind) => {
        const prompt = imagePrompt.trim()
        if (!prompt || prompt.length > 1000) return setImageError('提示词必须为 1–1000 字符')
        if (kind === 'edit' && !imageSource.trim()) return setImageError('请输入源图片的媒体根内相对路径')
        setBusy(kind)
        setImageError('')
        setImageResult('')
        try {
          const result = safeObject(await post('/media/image/' + kind, { prompt, size: imageSize, ...(kind === 'edit' ? { path: imageSource.trim() } : {}) }))
          if (!result.ok) setImageError(String(result.message || '图片操作失败'))
          else setImageResult(String(result.path || ''))
        } catch { setImageError('图片操作失败') }
        finally { setBusy('') }
      }

      const upload = (event) => {
        const file = event.target.files && event.target.files[0]
        event.target.value = ''
        if (!file || busy || mediaStatus?.stickers?.libraryAvailable !== true) return
        const reader = new FileReader()
        reader.onerror = () => props.toast('读取图片失败', 'err')
        reader.onload = async () => {
          if (mediaStatus?.stickers?.libraryAvailable !== true) return
          const encoded = String(reader.result || '')
          const comma = encoded.indexOf(',')
          setBusy('upload')
          const result = safeObject(await post('/media/stickers/upload', { name: file.name, mime: file.type, data: comma >= 0 ? encoded.slice(comma + 1) : encoded }))
          setBusy('')
          if (!result.ok) return props.toast('上传失败：' + String(result.message || '未知错误'), 'err')
          props.toast('表情包已上传', 'ok')
          refresh()
        }
        reader.readAsDataURL(file)
      }

      const uploadFile = async (event) => {
        const file = event.target.files && event.target.files[0]
        event.target.value = ''
        if (!file || fileBusy.current || busy || !mediaStatus?.enabled || !mediaStatus?.files?.enabled) return
        const limit = Number(mediaStatus?.maxBytes) || 10 * 1024 * 1024
        if (!file.size || file.size > limit) return setFilesError('文件为空或超过大小限制 ' + limit + ' bytes')
        const extension = '.' + String(file.name).split('.').pop().toLowerCase()
        if (!fileAccept.split(',').includes(extension)) return setFilesError('文件扩展名不在允许列表')
        fileBusy.current = true
        setBusy('file')
        setFilesError('')
        try {
          const dataBase64 = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onerror = () => reject(new Error('读取文件失败'))
            reader.onabort = () => reject(new Error('读取文件已取消'))
            reader.onload = () => {
              const encoded = String(reader.result || '')
              resolve(encoded.slice(encoded.indexOf(',') + 1))
            }
            reader.readAsDataURL(file)
          })
          const result = safeObject(await post('/media/file/upload', { name: file.name, dataBase64 }))
          if (!result.ok) return setFilesError(String(result.message || '文件上传失败'))
          props.toast('文件已上传', 'ok')
          await refreshFiles()
        } catch (error) { setFilesError(String(error?.message || '文件上传失败')) }
        finally { fileBusy.current = false; setBusy('') }
      }

      const fileAction = async (kind, item) => {
        if (fileBusy.current || busy || filesLoading || !mediaStatus?.enabled || !mediaStatus?.files?.enabled) return
        if (kind === 'delete' && (typeof window === 'undefined' || typeof window.confirm !== 'function' || !window.confirm('删除本地文件“' + String(item.name || '') + '”？删除后无法恢复。'))) return
        fileBusy.current = true
        setBusy('file-' + kind)
        setFilesError('')
        try {
          const path = String(item.path || '')
          const name = path.startsWith('files/') ? path.slice(6) : ''
          if (!name || /[\\/]/.test(name)) throw new Error('文件名无效，请刷新文件列表')
          const result = safeObject(await (kind === 'delete' ? deleteMediaFile(name) : downloadMediaFile(name)))
          if (!result.ok) throw new Error(result.message || '文件操作失败')
          if (kind === 'delete') {
            props.toast('文件已删除', 'ok')
            await refreshFiles()
          } else {
            if (typeof result.dataBase64 !== 'string') throw new Error('文件下载数据无效')
            const binary = atob(result.dataBase64)
            const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
            const blob = new Blob([bytes], { type: result.mime || 'application/octet-stream' })
            const link = document.createElement('a')
            const url = URL.createObjectURL(blob)
            try {
              link.href = url
              link.download = String(item.name || result.name)
              document.body.appendChild(link)
              link.click()
            } finally {
              link.remove()
              URL.revokeObjectURL(url)
            }
          }
        } catch (error) {
          const message = String(error?.message || '文件操作失败')
          setFilesError(message)
          props.toast(message, 'err')
        } finally { fileBusy.current = false; setBusy('') }
      }

      const editTags = async (item) => {
        if (mediaStatus?.stickers?.libraryAvailable !== true) return
        const current = safeArray(item.tags).join(', ')
        const value = typeof window !== 'undefined' && window.prompt ? window.prompt('标签（用逗号分隔）', current) : current
        if (value === null) return
        const result = safeObject(await post('/media/stickers/tag', { id: item.id, tags: value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) }))
        if (!result.ok) return props.toast('标签保存失败：' + String(result.message || '未知错误'), 'err')
        props.toast('标签已更新', 'ok')
        refresh()
      }

      const removeSticker = async (item) => {
        if (mediaStatus?.stickers?.libraryAvailable !== true) return
        if (typeof window !== 'undefined' && window.confirm && !window.confirm('删除表情包“' + String(item.name || '') + '”？')) return
        const result = safeObject(await post('/media/stickers/delete', { id: item.id }))
        if (!result.ok) return props.toast('删除失败：' + String(result.message || '未知错误'), 'err')
        props.toast('表情包已删除', 'ok')
        refresh()
      }

      useNavigationAnchor(props, 'ob-media-', !(loading && !mediaStatus))
      if (loading && !mediaStatus) return h('div', { className: 'ob-page' }, h('div', { className: 'ob-stat-grid' }, [0, 1, 2, 3, 4].map((index) => h(StatSkeleton, { key: index }))), h(PanelSkeleton, { rows: 4 }))
      const status = safeObject(mediaStatus)
      const images = safeObject(status.images)
      const audio = safeObject(status.audio)
      const stickerStatus = safeObject(status.stickers)
      const stickerLibraryAvailable = stickerStatus.libraryAvailable === true
      return h(
        'div',
        { className: 'ob-page' },
        error ? h(Banner, { tone: 'err', message: error, actions: h(Btn, { small: true, onClick: refresh }, '重试') }) : null,
        h('div', { className: 'ob-stat-grid' },
          h(StatTile, { label: '媒体总开关', value: status.enabled ? '已开启' : '已关闭', icon: 'sparkles', tone: status.enabled ? 'ok' : 'muted', hint: '默认关闭，无外部网络请求' }),
          h(StatTile, { label: 'Vision', value: images.configured ? '已配置' : '未配置', icon: 'overview', tone: images.configured ? 'ok' : 'warn', hint: images.visionEnabled ? '功能已启用' : '功能未启用' }),
          h(StatTile, { label: '生图', value: images.generate?.configured ? '已配置' : '未配置', icon: 'sparkles', tone: images.generate?.configured ? 'ok' : 'warn', hint: images.generate?.enabled ? '功能已启用' : '功能未启用' }),
          h(StatTile, { label: '改图', value: images.edit?.configured ? '已配置' : '未配置', icon: 'sparkles', tone: images.edit?.configured ? 'ok' : 'warn', hint: images.edit?.enabled ? '功能已启用' : '功能未启用' }),
          h(StatTile, { label: 'ASR', value: audio.asrConfigured ? '已配置' : '未配置', icon: 'message', tone: audio.asrConfigured ? 'ok' : 'warn', hint: audio.asrEnabled ? '功能已启用' : '功能未启用' }),
          h(StatTile, { label: 'TTS', value: audio.ttsConfigured ? '已配置' : '未配置', icon: 'bolt', tone: audio.ttsConfigured ? 'ok' : 'warn', hint: audio.ttsEnabled ? '功能已启用' : '功能未启用' }),
          h(StatTile, { label: '表情包', value: Number(stickerStatus.count) || 0, denominator: Number(stickerStatus.maxCount) || 200, icon: 'inbox', tone: 'brand', hint: !stickerLibraryAvailable ? '功能未启用' : '本地表情包库' }),
        ),
        h(Panel, { title: '生图/改图', description: '只生成本地 PNG 文件，不会发送到 QQ。改图仅接受媒体根内相对路径。' },
          h('div', { className: 'ob-stack' },
            h('textarea', { className: 'ob-input', 'aria-label': '图片提示词', value: imagePrompt, maxLength: 1000, placeholder: '输入提示词（1–1000 字符）', onChange: (event) => setImagePrompt(event.target.value) }),
            h('select', { className: 'ob-input', 'aria-label': '图片尺寸', value: imageSize, onChange: (event) => setImageSize(event.target.value) }, ['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792'].map((size) => h('option', { key: size, value: size }, size))),
            h('input', { className: 'ob-input', 'aria-label': '源图片相对路径', value: imageSource, placeholder: '源图片相对路径（仅改图需要，如 inbound/cat.png）', onChange: (event) => setImageSource(event.target.value) }),
            h('div', { className: 'ob-row' },
              h(Btn, { kind: 'primary', disabled: Boolean(busy) || !status.enabled || !images.generate?.enabled, busy: busy === 'generate', onClick: () => runImage('generate') }, '生成图片'),
              h(Btn, { disabled: Boolean(busy) || !status.enabled || !images.edit?.enabled, busy: busy === 'edit', onClick: () => runImage('edit') }, '编辑图片'),
            ),
            imageResult ? h('p', { className: 'ob-note ob-mono' }, '生成路径：' + imageResult) : null,
            imageError ? h(Banner, { tone: 'err', message: imageError }) : null,
          ),
        ),
        h(Panel, { title: 'TTS 测试', description: '只生成本地语音文件，不会发送到 QQ。' },
          h('div', { className: 'ob-stack' },
            h('div', { className: 'ob-row' }, h('input', { className: 'ob-input', value: ttsText, placeholder: '输入要合成的文本', onChange: (event) => setTtsText(event.target.value), style: { flex: '1 1 280px' } }), h(Btn, { kind: 'primary', icon: 'play', busy: busy === 'tts', onClick: runTts }, '生成语音')),
            ttsFile ? h('p', { className: 'ob-note ob-mono' }, '生成文件：' + ttsFile) : null,
          ),
        ),
        h(Panel, {
          title: '文件', description: '本地上传、下载与删除；发送到当前 QQ 会话由主人使用 /file 相对路径。',
          actions: h('div', { className: 'ob-row' },
            h('label', { className: cx('ob-btn small secondary', (Boolean(busy) || !status.enabled || !status.files?.enabled) && 'disabled') },
              busy === 'file' ? '上传中…' : '上传文件',
              h('input', { className: 'ob-sr-only', type: 'file', 'aria-label': '上传文件', accept: fileAccept, disabled: Boolean(busy) || !status.enabled || !status.files?.enabled, onChange: uploadFile })),
            h(Btn, { small: true, kind: 'ghost', icon: 'refresh', busy: filesLoading, disabled: Boolean(busy) || filesLoading, onClick: () => { if (!fileBusy.current) return refreshFiles() } }, '刷新文件')),
        },
          h('p', { className: 'ob-note' }, '单文件上限 ' + (Number(status.maxBytes) || 10 * 1024 * 1024) + ' bytes；按修改时间显示最新 500 项，合计 ' + (Number(filesData.totalBytes) || 0) + ' bytes。'),
          filesError ? h(Banner, { tone: 'err', message: filesError }) : null,
          safeArray(filesData.items).length ? h('div', { className: 'ob-stack' }, safeArray(filesData.items).map((item) => h('article', { key: item.path },
            h('p', { className: 'ob-media-name' }, String(item.name || '未命名')),
            h('p', { className: 'ob-note ob-mono' }, String(item.path || '')),
            h('p', { className: 'ob-note' }, String(Number(item.size) || 0) + ' bytes · ' + formatDateTime(item.at)),
            h('div', { className: 'ob-row' },
              h(Btn, { small: true, kind: 'ghost', disabled: Boolean(busy) || filesLoading || !status.enabled || !status.files?.enabled, onClick: () => fileAction('download', item) }, '下载'),
              h(Btn, { small: true, kind: 'danger', icon: 'trash', disabled: Boolean(busy) || filesLoading || !status.enabled || !status.files?.enabled, onClick: () => fileAction('delete', item) }, '删除')),
          ))) : !filesError ? h('p', { className: 'ob-note' }, '还没有文件') : null,
        ),
        moduleBacklink(props, 'builtin-media-features'),
        h(Panel, {
          id: 'ob-media-stickers', title: '表情包库', description: '支持 PNG、JPG、JPEG、GIF、WebP；标签可用于 QQ 命令 /sticker [标签]。',
          actions: h('div', { className: 'ob-row' }, h('label', { className: cx('ob-btn small secondary', (busy === 'upload' || !stickerLibraryAvailable) && 'disabled') }, h(Icon, { name: 'sparkles', size: 14 }), h('span', null, busy === 'upload' ? '上传中…' : '上传图片'), h('input', { className: 'ob-sr-only', type: 'file', accept: '.png,.jpg,.jpeg,.gif,.webp,image/png,image/jpeg,image/gif,image/webp', disabled: busy === 'upload' || !stickerLibraryAvailable, onChange: upload })), h(Btn, { small: true, kind: 'ghost', icon: 'refresh', busy: loading, onClick: refresh }, '刷新')),
        },
          stickerLibraryAvailable && !stickerStatus.sendAvailable ? h('p', { className: 'ob-note' }, stickerStatus.sendReason === 'IMAGES_DISABLED' ? '库可用；图片开关关闭导致发送禁用' : '库可用；发送服务不可用') : null,
          !stickerLibraryAvailable ? h('p', { className: 'ob-muted' }, '表情包功能未启用，请在模块详情检查状态与设置。') : items.length
            ? h('div', { className: 'ob-media-grid' }, items.map((item) => h('article', { className: 'ob-media-card', key: item.id },
                h('img', { className: 'ob-media-image', src: API + '/media/stickers/file?id=' + encodeURIComponent(item.id), alt: String(item.name || '表情包'), loading: 'lazy' }),
                h('p', { className: 'ob-media-name', title: String(item.name || '') }, String(item.name || '未命名')),
                h('div', { className: 'ob-row' }, safeArray(item.tags).length ? safeArray(item.tags).map((tag) => h(Badge, { key: tag, tone: 'muted' }, tag)) : h(Badge, { tone: 'muted' }, '无标签')),
                h('div', { className: 'ob-row' }, h(Btn, { small: true, kind: 'ghost', onClick: () => editTags(item) }, '编辑标签'), h(Btn, { small: true, kind: 'danger', icon: 'trash', onClick: () => removeSticker(item) }, '删除')),
              )))
            : h(EmptyState, { icon: 'inbox', title: '还没有表情包', description: '上传图片后，可在这里编辑标签，并通过 /sticker 命令随机发送。' }),
        ),
      )
    }

    function ContentPage(props) {
      return h(Panel, { title: '公共内容' },
        h('p', null, 'B站公共内容已移入「模块 → 媒体功能」详情。'),
        h(Btn, { onClick: () => props.goTo ? props.goTo({ tab: 'modules', moduleId: 'builtin-media-features', anchor: 'panel' }) : props.go?.('modules') }, '打开模块'),
        h(Banner, { tone: 'warn', message: 'QQ空间未实现：该能力需要 QQ 登录授权。' }),
      )
    }

    function MediaFeaturesPanel(props) {
      const [query, setQuery] = useState('')
      const [items, setItems] = useState([])
      const [loading, setLoading] = useState(false)
      const [error, setError] = useState('')
      const [bvid, setBvid] = useState('')
      const [comments, setComments] = useState(null)
      const [share, setShare] = useState('')
      const [lookupBusy, setLookupBusy] = useState(false)
      const [lookupError, setLookupError] = useState('')
      const lookupInFlight = useRef(false)

      const lookup = async (kind) => {
        if (lookupInFlight.current) return
        if (!bvid.trim()) return props.toast?.('请输入 BV 号', 'warn')
        lookupInFlight.current = true
        setLookupBusy(true)
        setLookupError('')
        setComments(null)
        setShare('')
        try {
          const result = safeObject(await get('/content/bilibili/' + kind + '?bvid=' + encodeURIComponent(bvid.trim())))
          if (result.ok === false) throw new Error(result.message || 'B站内容加载失败')
          if (kind === 'comments') setComments(safeArray(result.items))
          else setShare(String(result.url || ''))
        } catch (requestError) {
          setLookupError(String(requestError?.message || 'B站内容加载失败'))
        } finally {
          lookupInFlight.current = false
          setLookupBusy(false)
        }
      }

      const load = async (kind) => {
        const keyword = query.trim()
        if (kind === 'search' && !keyword) return props.toast?.('请输入搜索关键词', 'warn')
        setLoading(true)
        setError('')
        const path = kind === 'hot' ? '/content/bilibili/hot' : '/content/bilibili?q=' + encodeURIComponent(keyword)
        try {
          const result = safeObject(await get(path))
          if (result.ok === false) {
            setItems([])
            setError(String(result.message || 'B站内容加载失败'))
          } else setItems(safeArray(result.items))
        } catch (requestError) {
          setItems([])
          setError(String(requestError?.message || 'B站内容加载失败'))
        } finally {
          setLoading(false)
        }
      }

      return h(
        'div',
        { className: 'ob-page' },
        destinationButton(props, '返回媒体页', { tab: 'media' }),
        destinationButton(props, '返回内容页', { tab: 'content' }),
        h(Panel, { title: 'B站公共内容', description: '默认关闭；公开搜索、热门、视频信息与评论，不使用 Cookie/WBI 或登录态。' },
          h('div', { className: 'ob-row' },
            h('input', {
              className: 'ob-input', value: query, placeholder: '搜索 B站视频', style: { flex: '1 1 280px' },
              onChange: (event) => setQuery(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter') load('search') },
            }),
            h(Btn, { kind: 'primary', icon: 'search', busy: loading, onClick: () => load('search') }, '搜索'),
            h(Btn, { kind: 'secondary', icon: 'play', disabled: loading, onClick: () => load('hot') }, '热门'),
          ),
        ),
        h(Panel, { title: '公开评论与分享链接', description: '评论默认最多 10 条（API 上限 20），置顶优先；受登录要求或风控限制时会报错。不含字幕或发布评论。分享离线生成链接，不验证视频是否存在。' },
          h('div', { className: 'ob-row' },
            h('input', {
              className: 'ob-input', value: bvid, 'aria-label': 'B站 BV 号', placeholder: 'BV 号', disabled: lookupBusy, style: { flex: '1 1 240px' },
              onChange: (event) => { setBvid(event.target.value); setComments(null); setShare(''); setLookupError('') },
              onKeyDown: (event) => { if (event.key === 'Enter') lookup('comments') },
            }),
            h(Btn, { kind: 'primary', busy: lookupBusy, disabled: lookupBusy, onClick: () => lookup('comments') }, '查看公开评论'),
            h(Btn, { kind: 'secondary', disabled: lookupBusy, onClick: () => lookup('share') }, '生成分享链接'),
          ),
          lookupError ? h(Banner, { tone: 'err', message: lookupError }) : null,
          share ? h('a', { href: share, target: '_blank', rel: 'noreferrer' }, share) : null,
          comments !== null ? (comments.length
            ? h('ol', null, comments.map((item, index) => h('li', { key: index },
                h('strong', null, String(item.author || '匿名用户') + ' · 赞 ' + String(Number(item.like) || 0)),
                h('p', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, String(item.content || '')),
              )))
            : h('p', null, '没有可显示的 B站公开评论。')) : null,
        ),
        error ? h(Banner, { tone: 'err', message: error }) : null,
        loading ? h('div', { className: 'ob-grid two' }, h(PanelSkeleton, { rows: 3 }), h(PanelSkeleton, { rows: 3 })) : null,
        !loading && items.length ? h('div', { className: 'ob-grid two' }, items.map((item) => h(Panel, {
          key: item.bvid || item.url,
          title: String(item.title || '未命名视频'),
          description: String(item.author || '未知作者'),
          actions: h('a', { className: 'ob-btn small secondary', href: String(item.url || '#'), target: '_blank', rel: 'noreferrer' }, h(Icon, { name: 'link', size: 14 }), '打开'),
        }, h('div', { className: 'ob-row' },
          h(Badge, { tone: 'brand' }, String(item.bvid || 'BV')), h(Badge, { tone: 'muted' }, '播放 ' + String(Number(item.play) || 0)), h(Badge, { tone: 'muted' }, String(item.duration || '00:00')),
        )))) : null,
        !loading && !error && !items.length ? h(Panel, null, h(EmptyState, { icon: 'play', title: '还没有内容', description: '输入关键词搜索，或查看当前热门视频。B站内容能力默认关闭。' })) : null,
      )
    }

    function SecurityPage(props) {
      const [data, setData] = useState(null)
      const [loading, setLoading] = useState(true)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const refresh = useCallback(async () => {
        setLoading(true)
        const paths = ['/status', '/access/stats', '/backup', '/upgrade']
        const results = await Promise.allSettled(paths.map(async (path) => {
          const result = safeObject(await get(path))
          if (result.ok !== true) throw new Error(result.message || '读取失败')
          return result
        }))
        const next = {}, errors = []
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') next[['status', 'access', 'backup', 'upgrade'][index]] = result.value
          else errors.push(paths[index] + '：' + String(result.reason?.message || result.reason))
        })
        setData(next)
        setError(errors.join('；'))
        setLoading(false)
      }, [])
      useEffect(() => { refresh() }, [refresh])
      const check = async () => {
        setBusy(true)
        try {
          const result = safeObject(await post('/upgrade/check', { force: true }))
          if (result.ok !== true) throw new Error(result.message || '升级检查失败')
          await refresh()
          props.toast?.(result.updateAvailable ? '发现新版本：' + result.latest : '检查完成，暂无更新', 'ok')
        } catch (requestError) { setError(String(requestError.message || requestError)) }
        finally { setBusy(false) }
      }
      const status = safeObject(data?.status)
      const cfg = safeObject(status.config)
      const access = safeObject(data?.access)
      const backup = safeObject(data?.backup?.status)
      const upgrade = safeObject(data?.upgrade)
      const latest = safeObject(upgrade.cached)
      const media = safeObject(cfg.media)
      const image = safeObject(media.images), audio = safeObject(media.audio)
      const providers = [
        { name: 'Vision', enabled: media.enabled === true && image.visionEnabled === true, base: image.visionBaseUrl, model: image.visionModel, env: image.visionApiKeyEnv },
        { name: '生图', enabled: media.enabled === true && image.generateEnabled === true, base: image.generateBaseUrl, model: image.generateModel, env: image.generateApiKeyEnv },
        { name: '改图', enabled: media.enabled === true && image.editEnabled === true, base: image.editBaseUrl || image.generateBaseUrl, model: image.editModel || image.generateModel, env: image.editApiKeyEnv || image.generateApiKeyEnv },
        { name: 'ASR', enabled: media.enabled === true && audio.asrEnabled === true, base: audio.asrBaseUrl, model: audio.asrModel, env: audio.asrApiKeyEnv },
        { name: 'TTS', enabled: media.enabled === true && audio.ttsEnabled === true, base: audio.ttsBaseUrl, model: audio.ttsModel, env: audio.ttsApiKeyEnv },
      ]
      const checklist = [
        ['网关已连接', status.gateway?.state === 'connected', 'connect'],
        ['allowlist 模式并设置主人 QQ', access.mode === 'allowlist' && Boolean(access.ownerQQ), 'config'],
        ['至少一份本地备份', Number(backup.snapshotCount) > 0, 'backup'],
        ['任意 OneBot action 已关闭', cfg.security?.allowRawAction === false, 'config'],
        ['媒体 provider 已关闭或已填写 URL / 模型 / 环境变量名', typeof media.enabled === 'boolean' && providers.every((provider) => !provider.enabled || (provider.base && provider.model && provider.env)), 'config'],
        ['模块已人工审核：请逐一确认本地代码与权限（无法自动判定）', false, null],
      ]
      const goButton = (tab, label) => h(Btn, { small: true, kind: 'secondary', onClick: () => props.go?.(tab) }, label)
      return h('div', { className: 'ob-stack' },
        h(Banner, { tone: 'muted', message: props.ownerIntegration ? '安全状态与审计依赖 DSH 本机信任边界；安全字段在下方所有者设置保存，升级按钮只查询版本。' : '安全页依赖 DSH 本机信任边界；这里只读展示设置与审计，升级按钮只查询版本。' }),
        error ? h(Banner, { tone: 'err', message: error }) : null,
        h('div', { className: 'ob-row' }, h(Btn, { kind: 'secondary', icon: 'refresh', disabled: loading || busy, onClick: refresh }, '刷新安全状态')),
        loading ? h(PanelSkeleton, { rows: 4 }) : h('div', { className: 'ob-grid two' },
          h(Panel, { title: '访问控制', description: '白名单限制 QQ 触发与自动出站，不改变管理 API 鉴权。', actions: goButton('config', '前往配置') },
            h(KV, { rows: [
              ['模式', access.mode || '未知'], ['主人 QQ', access.ownerQQ || '未设置'],
              ['私聊 / 群白名单', String(access.allow?.private ?? '未知') + ' / ' + String(access.allow?.groups ?? '未知')],
              ['入站 / 出站拦截', String(access.counters?.inboundBlocked ?? '未知') + ' / ' + String(access.counters?.outboundBlocked ?? '未知')],
            ] }),
            h('p', { className: 'ob-small ob-muted' }, '最近 5 条审计（进程内元数据，重启清空）'),
            safeArray(access.recent).length ? h('ul', { className: 'ob-list' }, safeArray(access.recent).slice(-5).reverse().map((entry, index) =>
              h('li', { key: index, className: 'ob-small' }, formatDateTime(entry.at) + ' · ' + (entry.direction === 'in' ? '入站' : '出站') + ' · ' + String(entry.chatType || '') + ':' + String(entry.chatId || '') + ' · ' + String(entry.senderId || '') + ' · ' + String(entry.reason || '')),
            )) : h('p', { className: 'ob-small ob-muted' }, '暂无审计记录'),
          ),
          h(Panel, { title: '出站文本防泄漏', description: '只展示已保存的开关与处理策略，没有扫描内容/密钥。' },
            h(KV, { rows: [
              ['防泄漏开关', cfg.security ? (cfg.security.leakGuard?.enabled === false ? '禁用' : '启用') : '未知'],
              ['处理策略', cfg.security ? (cfg.security.leakGuard?.action === 'block' ? 'block（阻止发送）' : 'redact（脱敏后发送）') : '未知'],
            ] }),
            h('p', { className: 'ob-small ob-muted' }, '仅认知统一出站文本；不扫描媒体/文件，不检测 PII 或熵。可能误报或漏报；不提供统一审批或逐项权限。'),
          ),
          h(Panel, { title: '危险面', description: '本地模块在同一进程执行任意代码，权限门控不是沙箱；仅加载可信、已审核的模块。' },
            h(KV, { rows: [
              ['任意 OneBot action', cfg.security ? (cfg.security.allowRawAction ? '开启' : '关闭') : '未知'],
              ['备份应用恢复', typeof backup.allowRestore === 'boolean' ? (backup.allowRestore ? '允许' : '禁用') : '未知'],
              ...providers.map((provider) => [provider.name + ' 环境变量名', String(provider.env || '未设置')]),
            ] }),
            h('p', { className: 'ob-small ob-muted' }, '只展示 provider 环境变量名，不读取密钥值；填写完整不代表环境变量已设置或服务可用。'),
          ),
          h(Panel, { title: '上线检查', description: '首次连接后的检查清单；警告项需操作员处理。模块审核始终保留人工提醒。' },
            h('ul', { className: 'ob-list' }, checklist.map(([label, pass, tab]) => h('li', { key: label, className: 'ob-row' },
              h(Badge, { tone: pass ? 'ok' : 'warn' }, pass ? '通过' : '待检查'),
              h('span', { className: 'ob-small', style: { flex: '1 1 180px' } }, label),
              !pass && tab ? goButton(tab, tab === 'connect' ? '前往连接' : tab === 'backup' ? '前往备份' : '前往配置') : null,
            ))),
          ),
          h(Panel, { title: '升级', description: '手动查询 GitHub Releases；beta 仅允许结果包含预发布版。', actions: h(Btn, { small: true, kind: 'primary', disabled: busy || upgrade.enabled !== true, onClick: check }, busy ? '检查中…' : '检查更新') },
            h(KV, { rows: [
              ['当前版本', upgrade.current || status.version || '未知'], ['通道', upgrade.channel || '未知'],
              ['检查开关', upgrade.enabled === true ? '已启用' : '未启用'], ['最新版本', latest.latest || '尚未检查'],
              ['可用更新', typeof latest.updateAvailable === 'boolean' ? (latest.updateAvailable ? '有新版本' : '暂无更新') : '未知'],
              ['检查时间', upgrade.checkedAt ? formatDateTime(upgrade.checkedAt) : '尚未检查'],
            ] }),
            latest.url ? h('a', { href: latest.url, target: '_blank', rel: 'noopener noreferrer' }, '查看 Release') : null,
            latest.notes ? h('p', { className: 'ob-small', style: { whiteSpace: 'pre-wrap' } }, latest.notes) : null,
            h('p', { className: 'ob-small ob-muted' }, '默认关闭，不自动检查、下载或安装。未认证 GitHub API 通常每 IP 每小时 60 次请求；启用和缓存设置见配置。'),
          ),
        ),
      )
    }

    function BackupPage(props) {
      const [data, setData] = useState(null)
      const [loading, setLoading] = useState(true)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [note, setNote] = useState('')
      const [includeMedia, setIncludeMedia] = useState(() => getByPath(props.status?.config, 'ops.backup.includeMedia') === true)
      const [stagedPath, setStagedPath] = useState('')
      const refresh = useCallback(async () => {
        setLoading(true)
        try {
          const result = safeObject(await get('/backup'))
          if (result.ok === false) throw new Error(result.message || '备份列表加载失败')
          setData(result)
          setError('')
        } catch (requestError) { setError(String(requestError.message || requestError)) }
        finally { setLoading(false) }
      }, [])
      useEffect(() => { refresh() }, [refresh])
      const action = async (kind, item, apply) => {
        if (kind === 'delete' && typeof window !== 'undefined' && window.confirm && !window.confirm('删除备份 ' + item.id + '？')) return
        if (apply === true && typeof window !== 'undefined' && window.confirm && !window.confirm('应用恢复会覆盖本地文件。请先停止认知与模块等全部写入，并在完成后立即重启 DSH。继续？')) return
        setBusy(true)
        setError('')
        try {
          const body = kind === 'create' ? { note, includeMedia } : kind === 'restore' ? { id: item.id, apply: apply === true } : { id: item.id }
          const result = safeObject(await post('/backup/' + kind, body))
          if (result.ok === false) throw new Error(result.message || '备份操作失败')
          if (result.stagedPath) setStagedPath(String(result.stagedPath))
          if (kind === 'create') setNote('')
          props.toast?.(result.applied ? '恢复已应用，请立即重启 DSH' : result.stagedPath ? '已暂存恢复文件，替换后需要重启' : kind === 'delete' ? '备份已删除' : '备份已创建', 'ok')
          await refresh()
        } catch (requestError) { setError(String(requestError.message || requestError)) }
        finally { setBusy(false) }
      }
      const state = safeObject(data?.status)
      const items = safeArray(data?.items)
      const mib = (bytes) => (Number(bytes || 0) / 1048576).toFixed(2) + ' MiB'
      return h('div', { className: 'ob-stack' },
        h(Banner, { tone: 'warn', message: '备份是本地目录，包含配置、模型密钥与认知隐私，请按秘密保护。恢复需要重启；复制 SQLite 前应停止所有写入，在线复制不保证数据库一致性。' }),
        h('div', { className: 'ob-stat-grid' },
          h(StatTile, { label: '快照', value: Number(state.snapshotCount || 0), hint: state.enabled === false ? '备份服务已禁用' : '本地目录快照', icon: 'inbox' }),
          h(StatTile, { label: '总大小', value: mib(items.reduce((sum, item) => sum + Number(item.bytes || 0), 0)), hint: '已保存文件大小', icon: 'inbox' }),
          h(StatTile, { label: '保留上限', value: Number(state.maxSnapshots || 0), hint: '单次上限 ' + mib(state.maxBytes), icon: 'shield' }),
          h(StatTile, { label: '应用恢复', value: state.allowRestore === true ? '允许' : '禁用', hint: '默认只暂存，不覆盖文件', icon: 'shield' }),
        ),
        h(Panel, { title: '创建备份', description: '默认包含 config.json、models.json、cognition、modules 与表情包；勾选后包含数据目录内全部媒体。日志、临时文件、符号链接和备份目录始终排除。' },
          h('div', { className: 'ob-row' },
            h('input', { className: 'ob-input', value: note, maxLength: 1000, placeholder: '可选备注', 'aria-label': '备份备注', style: { flex: '1 1 240px' }, onChange: (event) => setNote(event.target.value) }),
            h('label', { className: 'ob-row ob-small' }, h('input', { type: 'checkbox', checked: includeMedia, onChange: (event) => setIncludeMedia(event.target.checked) }), '包含全部媒体'),
            h(Btn, { kind: 'primary', icon: 'inbox', disabled: busy || loading || state.enabled !== true, onClick: () => action('create') }, '创建备份'),
            h(Btn, { kind: 'secondary', icon: 'refresh', disabled: busy || loading, onClick: refresh }, '刷新'),
          ),
        ),
        error ? h(Banner, { tone: 'err', message: error }) : null,
        stagedPath ? h(Banner, { tone: 'ok', message: '已暂存到数据目录下：' + stagedPath + '。请检查文件，停止 DSH 后手动复制回数据目录，再启动 DSH。' }) : null,
        loading ? h(PanelSkeleton, { rows: 3 }) : items.length ? h('div', { className: 'ob-grid two' }, items.map((item) => h(Panel, {
          key: item.id, title: String(item.note || item.id), description: String(item.id) + ' · ' + formatDateTime(item.createdAt),
          actions: h('div', { className: 'ob-row' },
            h(Btn, { small: true, kind: 'secondary', disabled: busy || state.enabled !== true, onClick: () => action('restore', item, false) }, '暂存恢复'),
            h(Btn, { small: true, kind: 'danger', disabled: busy || state.enabled !== true || state.allowRestore !== true, onClick: () => action('restore', item, true) }, '应用恢复'),
            h(Btn, { small: true, kind: 'danger', disabled: busy || state.enabled !== true, onClick: () => action('delete', item) }, '删除'),
          ),
        }, h('div', { className: 'ob-row' },
          h(Badge, { tone: 'muted' }, mib(item.bytes)), h(Badge, { tone: 'muted' }, String(item.files) + ' 个文件'), h(Badge, { tone: 'muted' }, item.includeMedia ? '全部媒体' : '仅表情包'),
        )))) : h(Panel, null, h(EmptyState, { icon: 'inbox', title: '还没有备份', description: '创建首个本地目录快照。此页不提供 zip、云端传输、自动恢复、升级检查或迁移。' })),
      )
    }

    // Trusted compile-time registry. Components receive only frozen, bounded data;
    // no host callbacks, API clients, raw config or module exports cross this boundary.
    const previewText = (value, max) => typeof value === 'string' ? value.slice(0, max) : ''
    const previewBool = (value) => typeof value === 'boolean' ? value : null
    const previewNumber = (value, min, max) => Number.isInteger(value) && value >= min && value <= max ? value : null
    const previewSwitch = (value) => value === null ? '未加载' : value ? '开启' : '关闭'
    const previewValue = (value, unit = '') => value === null ? '未加载' : value + unit
    const previewBody = (summary, lines) => h('div', { className: 'ob-module-preview', 'aria-label': '内置模块只读预览' },
      h('p', { className: 'ob-muted ob-small' }, summary.text),
      lines.map((line, index) => h('p', { key: index, className: 'ob-small' }, line)),
    )
    const BUILTIN_MODULE_UI = Object.freeze({
      'learning.preview': function LearningPreview({ module, config, summary }) {
        return previewBody(summary, [
          '模块启用：' + previewSwitch(module.enabled),
          '学习开关：' + previewSwitch(config.enabled),
          '自动外部检索：' + previewSwitch(config.autoResearch),
          '未知检测：' + previewSwitch(config.detectUnknowns),
          '每小时任务上限：' + previewValue(config.maxTasksPerHour),
          '自动任务首次约 30 秒检查，完成后 60 秒；手动运行遵循认知开关与暂停状态。',
        ])
      },
      'reply-delivery.preview': function ReplyDeliveryPreview({ module, config, summary }) {
        return previewBody(summary, [
          '模块启用：' + previewSwitch(module.enabled),
          '允许气泡分条（模型决定）：' + previewSwitch(config.split),
          '异常长文兜底上限：' + previewValue(config.maxChars),
          '最多分条：' + previewValue(config.maxParts),
          '引用原消息：' + previewSwitch(config.quote) + '；群聊 @ 对方：' + previewSwitch(config.atSender),
          '气泡间隔：' + (config.split === false ? '分条关闭，无条间等待' : previewValue(config.delayMs, ' ms / 条间')),
        ])
      },
      'typing.preview': function TypingPreview({ module, config, summary }) {
        return previewBody(summary, [
          '模块启用：' + previewSwitch(module.enabled),
          '输入状态开关：' + previewSwitch(config.enabled),
          '输入状态有效状态：' + (module.enabled && module.status === 'loaded' && config.enabled === true ? '开启（仅私聊，依赖网关支持）' : '未生效'),
        ])
      },
      'proactivity.preview': function ProactivityPreview({ module, config, summary }) {
        return previewBody(summary, [
          '模块启用：' + previewSwitch(module.enabled),
          '主动行为开关：' + previewSwitch(config.enabled) + '（仅私聊）',
          '安静时段（本地小时）：' + previewValue(config.quietStart) + '–' + previewValue(config.quietEnd),
          '滚动 24 小时私聊上限：' + previewValue(config.maxPrivatePerDay),
          '群聊每日上限（保留配置，暂不发送）：' + previewValue(config.maxGroupPerDay),
          '最低熟悉度：' + previewValue(config.minFamiliarity) + '；无回应退避：' + previewValue(config.backoffHours, ' 小时'),
        ])
      },
      'reminders.preview': function RemindersPreview({ module, config, summary }) {
        return previewBody(summary, [
          '模块启用：' + previewSwitch(module.enabled),
          '主人提醒开关：' + previewSwitch(config.enabled),
          '每人格活跃提醒上限：' + previewValue(config.maxActive),
          '最短重复间隔：' + previewValue(config.minIntervalSeconds, ' s'),
          '最长重复间隔：' + previewValue(config.maxIntervalSeconds, ' s'),
          '到期检查间隔：' + previewValue(config.tickMs, ' ms'),
        ])
      },
      'sample.preview': function SamplePreview({ config, summary }) {
        return previewBody(summary, ['示例回复：' + (summary.configAvailable ? config.message : '未加载配置')])
      },
      'media-features.preview': function MediaFeaturesPreview({ module, config, summary }) {
        const libraryEnabled = module.enabled && module.status === 'loaded' && config.stickersEnabled && config.mediaEnabled
        return previewBody(summary, [
          '模块启用：' + previewSwitch(module.enabled),
          'B站公共内容：' + previewSwitch(config.bilibiliEnabled),
          '表情包开关：' + previewSwitch(config.stickersEnabled),
          '媒体总开关：' + previewSwitch(config.mediaEnabled) + '；图片开关：' + previewSwitch(config.imagesEnabled),
          '表情包库有效状态：' + (libraryEnabled ? '开启' : '未生效'),
          '表情包发送有效状态：' + (libraryEnabled && config.imagesEnabled ? '开启' : '未生效'),
        ])
      },
      'media-features.panel': MediaFeaturesPanel,
    })

    function builtinPreviewProps(item, key, draft, editor) {
      const config = {}
      let configAvailable = false
      // Select fields individually. Never pass the global draft (which may contain secrets).
      if (key === 'reply-delivery.preview') {
        const raw = safeObject(draft?.cognition?.reply)
        Object.assign(config, { split: previewBool(raw.split), maxChars: previewNumber(raw.maxChars, 80, 2000), maxParts: previewNumber(raw.maxParts, 1, 10), quote: previewBool(raw.quote), atSender: previewBool(raw.atSender), delayMs: previewNumber(raw.delayMs, 0, 5000) })
        configAvailable = isPlainObject(draft?.cognition?.reply)
      } else if (key === 'typing.preview') {
        config.enabled = previewBool(draft?.cognition?.typing?.enabled)
        configAvailable = config.enabled !== null
      } else if (key === 'learning.preview') {
        const raw = safeObject(draft?.cognition?.learning)
        Object.assign(config, { enabled: previewBool(raw.enabled), autoResearch: previewBool(raw.autoResearch), detectUnknowns: previewBool(raw.detectUnknowns), maxTasksPerHour: previewNumber(raw.maxTasksPerHour, 0, 30) })
        configAvailable = isPlainObject(draft?.cognition?.learning)
      } else if (key === 'proactivity.preview') {
        const raw = safeObject(draft?.cognition?.proactivity)
        const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null
        Object.assign(config, { enabled: previewBool(raw.enabled), quietStart: previewNumber(raw.quietStart, 0, 23), quietEnd: previewNumber(raw.quietEnd, 0, 23), maxPrivatePerDay: previewNumber(raw.maxPrivatePerDay, 0, 10), maxGroupPerDay: previewNumber(raw.maxGroupPerDay, 0, 10), minFamiliarity: finite(raw.minFamiliarity, 0, 1), backoffHours: previewNumber(raw.backoffHours, 1, 720) })
        configAvailable = isPlainObject(draft?.cognition?.proactivity)
      } else if (key === 'reminders.preview') {
        const raw = safeObject(draft?.cognition?.reminders)
        Object.assign(config, { enabled: previewBool(raw.enabled), maxActive: previewNumber(raw.maxActive, 1, 1000), minIntervalSeconds: previewNumber(raw.minIntervalSeconds, 60, 2592000), maxIntervalSeconds: previewNumber(raw.maxIntervalSeconds, 60, 2592000), tickMs: previewNumber(raw.tickMs, 1000, 3600000) })
        configAvailable = isPlainObject(draft?.cognition?.reminders)
      } else if (key === 'media-features.preview') {
        Object.assign(config, { bilibiliEnabled: previewBool(draft?.content?.bilibili?.enabled), stickersEnabled: previewBool(draft?.media?.stickers?.enabled), mediaEnabled: previewBool(draft?.media?.enabled), imagesEnabled: previewBool(draft?.media?.images?.enabled) })
        configAvailable = config.bilibiliEnabled !== null && config.stickersEnabled !== null
      } else if (key === 'sample.preview') {
        configAvailable = editor?.id === item.id && typeof editor.values?.message === 'string'
        config.message = configAvailable ? previewText(editor.values.message, 200) : ''
      }
      return Object.freeze({
        module: Object.freeze({ id: previewText(item.id, 64), name: previewText(item.name, 128), status: ['disabled', 'loading', 'loaded', 'blocked', 'error'].includes(item.status) ? item.status : 'error', enabled: item.enabled === true }),
        config: Object.freeze(config),
        summary: Object.freeze({ readOnly: true, configAvailable, text: '当前配置草稿预览（只读）' }),
      })
    }

    function validSandboxUiEntry(entry) {
      return typeof entry === 'string' && entry.length <= 256 && entry.startsWith('webui/') && entry.endsWith('.html') && entry.split('/').length <= 9 && entry.split('/').every((part) => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part))
    }

    // Opaque frames have origin "null"; source + fresh nonce identify this load.
    function attachSandboxBridge(frame, metadata, callbacks, host = window) {
      const source = frame.contentWindow
      const random = new Uint8Array(16)
      host.crypto.getRandomValues(random)
      const nonce = Array.from(random, (byte) => byte.toString(16).padStart(2, '0')).join('')
      let active = true, ready = false, notifications = 0
      const stop = () => { active = false; host.removeEventListener('message', receive); host.clearTimeout(timer) }
      const receive = (event) => {
        if (!active || !callbacks.current() || frame.contentWindow !== source || event.source !== source || event.origin !== 'null') return
        const data = event.data
        if (!isPlainObject(data) || data.version !== 1 || data.nonce !== nonce || !['ready', 'resize', 'notify'].includes(data.type)) return
        const allowed = ['version', 'nonce', 'type', ...(data.type === 'resize' ? ['height'] : data.type === 'notify' ? ['text'] : [])]
        if (Object.keys(data).some((key) => !allowed.includes(key))) return
        if (data.type === 'ready') { ready = true; host.clearTimeout(timer); return }
        if (!ready) return
        if (data.type === 'resize' && Number.isInteger(data.height) && data.height >= 120 && data.height <= 1000) callbacks.resize(data.height)
        if (data.type === 'notify' && typeof data.text === 'string' && data.text.length > 0 && data.text.length <= 200 && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(data.text) && notifications < 20) {
          notifications++
          callbacks.notify(data.text)
        }
      }
      const timer = host.setTimeout(stop, 10000)
      host.addEventListener('message', receive)
      // '*' is required for an opaque target. This contains no secrets or capabilities.
      try {
        source.postMessage({ version: 1, type: 'init', nonce, module: { id: String(metadata.id).slice(0, 64), generation: String(metadata.generation).slice(0, 64), uiRevision: String(metadata.uiRevision).slice(0, 64) } }, '*')
      } catch (error) { stop(); throw error }
      return stop
    }

    function SandboxModuleFrame({ item, entry, toast }) {
      const frame = useRef(null), cleanup = useRef(null), mounted = useRef(true)
      const [height, setHeight] = useState(320)
      useEffect(() => { mounted.current = true; return () => { mounted.current = false; cleanup.current?.(); cleanup.current = null } }, [])
      return h('iframe', {
        ref: frame, title: '隔离 WebUI · ' + String(item.id),
        src: '/onebot-qq/module-ui/' + encodeURIComponent(item.id) + '/' + encodeURIComponent(item.generation) + '/' + entry.slice('webui/'.length),
        sandbox: 'allow-scripts', referrerPolicy: 'no-referrer',
        style: { width: '100%', minWidth: 0, maxWidth: '100%', height: height + 'px', border: 0 },
        onLoad: () => {
          cleanup.current?.()
          if (!mounted.current || !frame.current) return
          try {
            const current = frame.current
            cleanup.current = attachSandboxBridge(current, item, { current: () => mounted.current && frame.current === current, resize: setHeight, notify: (text) => toast?.(text, 'info') })
          } catch { cleanup.current = null }
        },
      })
    }

    function ModulesPage(props) {
      const [items, setItems] = useState([])
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState('')
      const [editor, setEditor] = useState(null)
      const [configError, setConfigError] = useState('')
      const [uiCatalog, setUiCatalog] = useState(null)
      const [uiError, setUiError] = useState('')
      const [detailId, setDetailId] = useState(props.navigation?.moduleId || '')
      const [cardOperation, setCardOperation] = useState(null)
      const actionGuard = useRef({ active: true, busy: false })
      const consumedNavigation = useRef(null)
      const [healthRevision, setHealthRevision] = useState(0)
      const [healthSnapshot, setHealthSnapshot] = useState(null)
      const receiveHealth = useCallback(value => setHealthSnapshot(value), [])
      const landingRef = useRef(null)
      const lastLandingRef = useRef(null)
      const requestedAnchorRef = useRef(null)
      useLayoutEffect(() => {
        if (loading && !items.length) return
        const root = landingRef.current?.closest('.ob-root')
        const heading = root?.querySelector('#ob-page-title')
        const destination = detailId ? 'module:' + detailId : 'list'
        if (!root || !heading || lastLandingRef.current === destination) return
        root.scrollTop = 0
        heading.focus({ preventScroll: true })
        lastLandingRef.current = destination
        if (requestedAnchorRef.current) {
          root.querySelector(requestedAnchorRef.current)?.scrollIntoView?.({ block: 'start' })
          requestedAnchorRef.current = null
        }
      }, [detailId, loading, items.length])
      useEffect(() => { actionGuard.current.active = true; return () => { actionGuard.current.active = false } }, [])
      useNavigationAnchor(props, 'ob-module-', !loading && Boolean(detailId))

      useEffect(() => {
        if (!props.navigation?.fieldPath || loading || typeof document === 'undefined') return
        const timer = setTimeout(() => document.getElementById(navigationFieldId(props.navigation))?.scrollIntoView?.({ block: 'center' }), 0)
        return () => clearTimeout(timer)
      }, [props.navigation, editor, loading, detailId])

      const uiFor = (item) => {
        const ui = safeArray(uiCatalog?.items).find((row) => row?.moduleId === item.id)
        if (uiCatalog?.version !== 1 || !ui || ui.uiWarning || typeof item.uiRevision !== 'string' || typeof item.generation !== 'string' || ui.generation !== item.generation || ui.uiRevision !== item.uiRevision || ui.status !== item.status) return null
        if (Object.keys(ui).some((key) => !['moduleId', 'source', 'trust', 'generation', 'uiRevision', 'status', 'config', 'surfaces', 'requestedCapabilities', 'grantedCapabilities', 'uiWarning', 'sandbox'].includes(key))) return null
        const source = item.builtin ? 'builtin' : 'external'
        if (item.source !== source || ui.trust !== source || ui.source !== source || !Array.isArray(ui.surfaces) || ui.surfaces.length > 5) return null
        const config = ui.config
        if (!isPlainObject(config) || Object.keys(config).some((key) => !['binding', 'schemaVersion', 'available'].includes(key))) return null
        if (!['none', 'legacy-core', 'module-file'].includes(config.binding) || typeof config.available !== 'boolean') return null
        if (config.schemaVersion !== null && (!Number.isSafeInteger(config.schemaVersion) || config.schemaVersion < 1)) return null
        if (config.binding === 'none' && (config.available || config.schemaVersion !== null)) return null
        if (config.binding === 'legacy-core' && source !== 'builtin') return null
        if (source === 'external' && config.available && (!item.hasConfig || config.binding !== 'module-file' || config.schemaVersion !== 1)) return null
        if (![ui.requestedCapabilities, ui.grantedCapabilities].every((caps) => Array.isArray(caps) && caps.length <= 1 && caps.every((cap) => cap === 'ui.sandbox'))) return null
        if (ui.sandbox !== undefined) {
          if (source !== 'external' || !isPlainObject(ui.sandbox) || Object.keys(ui.sandbox).some((key) => !['entry', 'available', 'reason'].includes(key)) || !validSandboxUiEntry(ui.sandbox.entry) || typeof ui.sandbox.available !== 'boolean' || typeof ui.sandbox.reason !== 'string' || ui.sandbox.reason.length > 200 || !ui.requestedCapabilities.includes('ui.sandbox')) return null
        } else if (ui.requestedCapabilities.length || ui.grantedCapabilities.length) return null
        if (ui.grantedCapabilities.length && (!ui.sandbox?.available || !safeArray(item.permissions).includes('ui:sandbox'))) return null
        const hooks = new Set(), ids = new Set()
        let sandboxCount = 0
        for (const surface of ui.surfaces) {
          if (!surface || typeof surface.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(surface.id) || ids.has(surface.id) || hooks.has(surface.hook)) return null
          if (Object.keys(surface).some((key) => !['id', 'hook', 'renderer', 'order', 'componentKey'].includes(key))) return null
          if (!['module.card', 'module.detail', 'module.config', 'module.actions', 'module.panel'].includes(surface.hook) || !['status', 'schema', 'builtin-react', 'sandbox'].includes(surface.renderer)) return null
          if (source === 'external' && surface.hook === 'module.config' && surface.renderer === 'schema' && !item.hasConfig) return null
          if (surface.renderer === 'sandbox' && (source !== 'external' || !ui.sandbox || !['module.detail', 'module.panel'].includes(surface.hook) || ++sandboxCount > 1)) return null
          if (surface.renderer === 'builtin-react') {
            if (source !== 'builtin' || typeof surface.componentKey !== 'string' || surface.componentKey.length > 64 || !/^[a-z][a-z0-9-]{0,31}\.[a-z][a-z0-9-]{0,31}$/.test(surface.componentKey)) return null
          } else if (Object.prototype.hasOwnProperty.call(surface, 'componentKey')) return null
          if (!Number.isInteger(surface.order) || surface.order < -100 || surface.order > 100) return null
          ids.add(surface.id); hooks.add(surface.hook)
        }
        if (ui.sandbox && sandboxCount !== 1) return null
        return ui
      }

      const hasConfigUi = (item, ui) => item.hasConfig && ui?.config.available === true && ui.config.binding === 'module-file' && ui.surfaces.some((surface) => surface.hook === 'module.config' && surface.renderer === 'schema')
      const configReadOnly = (item) => !item.enabled || item.status !== 'loaded'
      const legacyFields = buildFieldSpecs(props.configInfo?.groups).flatMap((group) => group.fields)
      const hasLegacyConfigUi = (item, ui) => item.builtin && item.source === 'builtin' && ui?.config.binding === 'legacy-core' && ui.config.available === true && ui.surfaces.some((surface) => surface.hook === 'module.config' && surface.renderer === 'schema')
      const legacyReadOnly = (item) => Boolean(busy) || configReadOnly(item) || !props.draft || typeof props.saveUiPatch !== 'function'

      const readModuleConfig = async (id) => {
        const result = safeObject(await get('/modules/config?id=' + encodeURIComponent(id)))
        if (result.ok === false) throw new Error(String(result.message || '模块配置加载失败'))
        setEditor({ id, schema: result.schema, values: result.values, revision: result.revision })
      }

      const openConfig = async (item) => {
        if (busy || !hasConfigUi(item, uiFor(item))) return
        setBusy(item.id + ':config')
        setEditor({ id: item.id, schema: null, values: {}, revision: 0 })
        setConfigError('')
        try { await readModuleConfig(item.id) }
        catch (error) { setConfigError(String(error.message || '模块配置加载失败')) }
        finally { setBusy('') }
      }

      const openDetail = async (item, anchor = 'detail') => {
        if (busy) return
        if (props.ownerIntegration && (props.navigation?.moduleId !== item.id || anchor !== 'detail')) { props.goTo?.({ area: 'extensions', section: 'module', moduleId: item.id, anchor: 'ob-module-' + anchor }); return }
        requestedAnchorRef.current = anchor === 'config' ? '#ob-module-config' : null
        setDetailId(item.id)
        setEditor(null)
        setConfigError('')
        if (hasConfigUi(item, uiFor(item))) await openConfig(item)
      }

      const saveModuleConfig = async () => {
        const item = items.find((item) => item.id === detailId)
        if (busy || !editor?.schema || editor.id !== detailId || !item || configReadOnly(item) || !hasConfigUi(item, uiFor(item))) return
        setBusy(editor.id + ':save')
        setConfigError('')
        try {
          const result = safeObject(await post('/modules/config', { id: editor.id, values: editor.values, revision: editor.revision }))
          if (result.ok === false) {
            setConfigError(result.code === 'MODULE_CONFIG_CONFLICT' ? '配置冲突：配置已被修改，请重新加载后再编辑保存。' : String(result.message || '模块配置保存失败'))
            return
          }
          // 保存已成功，即使后续 GET 失败也保留新的 revision。
          setEditor({ id: editor.id, schema: result.schema, values: result.values, revision: result.revision })
          await readModuleConfig(editor.id)
          await refresh()
          props.toast?.('模块配置已保存', 'ok')
        } catch (error) { setConfigError(String(error.message || '模块配置保存失败')) }
        finally { setBusy('') }
      }

      const refresh = useCallback(async () => {
        setLoading(true)
        setError('')
        setUiCatalog(null)
        setUiError('')
        try {
          const [modulesResult, uiResult] = await Promise.allSettled([get('/modules'), get('/modules/ui')])
          if (modulesResult.status === 'rejected') throw modulesResult.reason
          const result = safeObject(modulesResult.value)
          if (result.ok === false) setError(String(result.message || '模块列表加载失败'))
          else { setItems(safeArray(result.items)); setHealthRevision(value => value + 1) }
          if (uiResult.status === 'fulfilled' && uiResult.value?.ok === true && uiResult.value?.version === 1 && Array.isArray(uiResult.value.items)) setUiCatalog(uiResult.value)
          else setUiError('UI 目录暂不可用，模块操作仍可使用。')
        } catch (error) { setError(String(error.message || '模块列表加载失败')) }
        finally { setLoading(false) }
      }, [])

      useEffect(() => { refresh() }, [refresh])
      useEffect(() => {
        if (!props.navigation || consumedNavigation.current === props.navigation || loading || busy) return
        const target = props.navigation.moduleId
        if (target) {
          const item = items.find(row => row.id === target)
          if (item) { consumedNavigation.current = props.navigation; openDetail(item) }
        } else { consumedNavigation.current = props.navigation; setDetailId(''); setEditor(null) }
      }, [props.navigation, items, uiCatalog, loading, busy])

      const action = async (item, kind) => {
        if (actionGuard.current.busy || (cardOperation && !operationTerminal(cardOperation))) return
        actionGuard.current.busy = true
        const key = String(item.id) + ':' + kind
        setBusy(key)
        try {
          if (item.builtin) {
            const result = await invokeModuleAction(item.id, kind === 'reload' ? 'module.reload' : item.enabled ? 'module.disable' : 'module.enable', { current: () => actionGuard.current.active, onOperation: value => { if (actionGuard.current.active) setCardOperation(value) } })
            if (result) {
              const ok = operationSucceeded(result)
              const message = ok ? '动作完成' : result.code || '动作未成功'
              if (!ok) setError(message)
              props.toast?.(message, ok ? 'ok' : 'err')
              await refresh()
            }
            return
          }
          const result = safeObject(await post(kind === 'reload' ? '/modules/reload' : '/modules/toggle', kind === 'reload' ? { id: item.id } : { id: item.id, enabled: !item.enabled }))
          if (result.ok === false) {
            const message = String(result.message || '模块操作失败')
            setError(message)
            props.toast?.(message, 'err')
            return
          }
          const status = result.item?.status
          const failed = status === 'error' || status === 'blocked'
          props.toast?.(failed ? (status === 'blocked' ? '模块被依赖阻塞' : '模块加载失败') : (status === 'disabled' ? '模块已停用' : '模块已加载'), failed ? 'err' : 'ok')
          await refresh()
        } catch (error) {
          const message = String(error.message || '模块操作失败')
          setError(message)
          props.toast?.(message, 'err')
        } finally { actionGuard.current.busy = false; if (actionGuard.current.active) setBusy('') }
      }

      const cardOperationStatus = cardOperation ? h('div', { role: 'status' },
        h('p', null, 'operation：' + cardOperation.status + ' · ' + cardOperation.phase + ' · ' + observedValue(cardOperation.code)),
        cardOperation.status === 'STOP_PENDING' ? h('p', null, 'STOP_PENDING：仍在排空，尚未完成。') : null,
        !busy && !operationTerminal(cardOperation) ? h(Btn, { onClick: async () => {
          if (actionGuard.current.busy) return
          actionGuard.current.busy = true; setBusy('operation')
          try { await pollModuleOperation(cardOperation, { current: () => actionGuard.current.active, onOperation: value => { if (actionGuard.current.active) setCardOperation(value) } }); await refresh() }
          catch (err) { setError(String(err.message)) }
          finally { actionGuard.current.busy = false; setBusy('') }
        } }, '继续观察操作') : null,
      ) : null

      const badges = (item) => h('div', { className: 'ob-row' },
        h(Badge, { tone: item.builtin ? 'brand' : 'muted' }, item.builtin ? '内置受信任' : uiFor(item)?.sandbox ? '外部隔离 WebUI' : '外部声明式（无执行权限）'),
        h(Badge, { tone: item.status === 'loaded' ? 'ok' : ['error', 'blocked'].includes(item.status) ? 'err' : 'muted' }, moduleStatusLabel(item.status)),
        h(Badge, { tone: item.enabled ? 'brand' : 'muted' }, item.enabled ? '已启用' : '已停用'),
      )
      const statusSummary = (item, surface) => h('section', { key: surface.id, 'aria-label': surface.hook, className: 'ob-stack' },
        h('p', { className: 'ob-small' }, String(item.description || item.name || item.id)),
        h('p', { className: 'ob-muted ob-small' }, '状态：' + String(item.status || 'unknown')),
      )
      const configSurface = (item, surface) => h('section', { key: surface.id, className: 'ob-stack', 'aria-label': '模块配置' },
        h('h3', null, '模块配置'),
        configReadOnly(item) ? h('p', { className: 'ob-muted ob-small' }, '模块未运行，配置只读；启用并加载成功后可编辑。') : null,
        editor?.id === item.id ? h('div', { className: 'ob-stack' },
          h('p', { className: 'ob-muted ob-small' }, '模块配置 · revision ' + editor.revision),
          configError ? h(Banner, { tone: 'err', message: configError }) : null,
          safeArray(editor.schema?.fields).map((spec) => h(FieldRow, {
            key: item.id + ':' + spec.path, spec, value: editor.values[spec.path], disabled: Boolean(busy) || configReadOnly(item),
            onChange: (value) => { if (!busy && !configReadOnly(item)) setEditor((current) => ({ ...current, values: { ...current.values, [spec.path]: value } })) },
          })),
        ) : h(Btn, { small: true, kind: 'secondary', disabled: Boolean(busy), onClick: () => openConfig(item) }, '加载配置'),
      )
      const legacyConfigSurface = (item, surface) => h('section', { key: surface.id, className: 'ob-stack', 'aria-label': '模块配置' },
        h('h3', null, '模块设置'),
        h('p', { className: 'ob-muted ob-small' }, '这些设置属于本模块；存储键保持不变，沿用现有全局配置保存。'),
        configReadOnly(item) ? h('p', { className: 'ob-muted ob-small' }, '模块未运行，配置只读；启用并加载成功后可编辑。') : null,
        legacyFields.filter((spec) => spec.module === item.id).map((spec) => h(FieldRow, {
          key: spec.path, spec, value: getByPath(props.draft || {}, spec.path), disabled: legacyReadOnly(item),
          onChange: (value) => { if (!legacyReadOnly(item)) props.saveUiPatch({ [spec.path]: value }) },
        })),
        props.prefStatus ? h(PreferenceSaveStatus, { status: props.prefStatus }) : null,
      )
      const grantSandbox = async (item, enabled) => {
        if (busy || !window.confirm(enabled ? '启用隔离 WebUI？将运行此外部模块的 HTML/脚本。它不能读取宿主 DOM、Cookie、配置或 API；请先审核公开 UI 文件。' : '撤销隔离 WebUI 授权？界面将移除，模块配置保留。')) return
        setBusy(item.id + ':grant')
        try {
          const result = await post('/modules/ui/grant', { id: item.id, enabled })
          if (result?.ok !== true) throw new Error(String(result?.message || '隔离 UI 授权失败'))
          // Unmount immediately, even if refreshing the directory fails.
          setUiCatalog(null)
          await refresh()
        } catch (error) { props.toast?.(String(error.message || '隔离 UI 授权失败'), 'err') }
        finally { setBusy('') }
      }
      const renderSurface = (item, ui, surface) => {
        if (surface.renderer === 'sandbox') {
          const permitted = item.source === 'external' && !item.builtin && safeArray(item.permissions).includes('ui:sandbox')
          const granted = permitted && ui.grantedCapabilities.includes('ui.sandbox')
          const executable = granted && ui.sandbox.available && item.enabled === true && item.status === 'loaded'
          return h('section', { key: surface.id, className: 'ob-stack', 'aria-label': '隔离 WebUI' },
            h('h3', null, '隔离 WebUI'),
            h('p', { className: 'ob-muted ob-small' }, '外部 HTML/脚本在不透明源 iframe 内运行；无宿主 DOM、Cookie、配置或 API 访问。'),
            executable ? h(SandboxModuleFrame, { key: item.id + ':' + item.generation + ':' + item.uiRevision, item: { id: item.id, generation: item.generation, uiRevision: item.uiRevision }, entry: ui.sandbox.entry, toast: props.toast })
              : h('p', { className: 'ob-muted ob-small' }, !permitted ? '缺少 ui:sandbox 权限' : ui.sandbox.reason || (!granted ? '未授权或授权已失效，请确认后启用隔离 WebUI' : '模块未启用或未加载，隔离 WebUI 已禁用')),
            h(Btn, { small: true, kind: granted ? 'danger' : 'secondary', disabled: Boolean(busy) || !permitted || (!granted && !ui.sandbox.available), onClick: () => grantSandbox(item, !granted) }, granted ? '撤销' : '启用隔离 WebUI'),
          )
        }
        if (surface.hook === 'module.panel' && surface.renderer === 'builtin-react' && surface.componentKey === 'media-features.panel' && item.id === 'builtin-media-features' && item.builtin && item.source === 'builtin') {
          return item.enabled && item.status === 'loaded'
            ? h(MediaFeaturesPanel, { ...props, key: surface.id })
            : h('p', { key: surface.id, className: 'ob-muted' }, '媒体功能模块未运行。')
        }
        if (surface.hook === 'module.detail' && surface.renderer === 'builtin-react' && surface.componentKey.endsWith('.preview')) {
          const Component = Object.prototype.hasOwnProperty.call(BUILTIN_MODULE_UI, surface.componentKey) ? BUILTIN_MODULE_UI[surface.componentKey] : null
          return h('section', { key: surface.id, 'aria-label': surface.hook, className: 'ob-stack' },
            Component ? h(Component, builtinPreviewProps(item, surface.componentKey, props.draft, editor))
              : h('p', { className: 'ob-muted ob-small' }, '内置预览组件不可用，显示核心模块信息。'),
          )
        }
        if (['module.card', 'module.detail'].includes(surface.hook) && surface.renderer === 'status') return statusSummary(item, surface)
        if (surface.hook === 'module.config' && surface.renderer === 'schema' && hasLegacyConfigUi(item, ui)) return legacyConfigSurface(item, surface)
        if (surface.hook === 'module.config' && hasConfigUi(item, ui)) return configSurface(item, surface)
        return h('section', { key: surface.id, 'aria-label': surface.hook, className: 'ob-stack' },
          h('p', { className: 'ob-muted ob-small' }, surface.hook + ' · 暂不可用'),
          h(Btn, { small: true, kind: 'secondary', disabled: true }, '暂不可用'),
        )
      }

      if (loading && !items.length) return h('div', { className: 'ob-module-list ob-module-scope' }, h('div', { className: 'ob-module-grid' }, h(PanelSkeleton, { rows: 3 }), h(PanelSkeleton, { rows: 3 })))
      if (detailId) {
        const item = items.find((item) => item.id === detailId)
        const ui = item ? uiFor(item) : null
        const primaryConfigReasonId = 'ob-module-primary-config-' + detailId + '-reason'
        const primaryToggleReasonId = 'ob-module-primary-toggle-' + detailId + '-reason'
        const backToList = event => {
          event?.preventDefault()
          if (busy) return
          if (props.ownerIntegration) props.goTo?.({ area: 'extensions', section: 'modules' })
          else { setDetailId(''); setEditor(null); setConfigError('') }
        }
        return h('section', { ref: landingRef, id: 'ob-module-detail', className: 'ob-stack ob-module-scope ob-module-detail', 'aria-label': '模块详情' },
          h('div', { className: 'ob-module-detail-toolbar', role: 'group', 'aria-label': '模块详情工具栏' },
            h('nav', { className: 'ob-module-breadcrumb', 'aria-label': '面包屑' },
              h('a', { className: 'ob-module-back', href: navigationUrl(window.location?.href || 'http://localhost/', { area: 'extensions', section: 'modules' }), 'aria-disabled': Boolean(busy), tabIndex: busy ? -1 : undefined, onClick: backToList }, '← 模块目录'),
              h('span', { 'aria-hidden': true }, '/'),
              h('span', { className: 'ob-module-breadcrumb-current', 'aria-current': 'page', title: String(item?.name || '模块详情') }, String(item?.name || '模块详情'))),
            h(Btn, { kind: 'ghost', icon: 'refresh', title: '刷新', 'aria-label': '刷新详情', disabled: Boolean(busy) || loading, onClick: refresh }),
          ),
          h('header', { className: 'ob-module-detail-header' },
            h('h1', { id: 'ob-page-title', tabIndex: -1, className: 'ob-display' }, String(item?.name || '模块详情')),
            item ? h(Fragment, null,
              h('p', { className: 'ob-module-id' }, h('code', { className: 'ob-module-code', tabIndex: 0 }, item.id)),
              badges(item),
              h('div', { className: 'ob-module-primary-actions', role: 'group', 'aria-label': '模块主要操作' },
                h(Btn, { kind: 'primary', disabled: Boolean(busy) || !(hasConfigUi(item, ui) || hasLegacyConfigUi(item, ui)), 'aria-describedby': primaryConfigReasonId, onClick: async () => {
                  if (hasConfigUi(item, ui) && editor?.id !== item.id) await openConfig(item)
                  landingRef.current?.querySelector('#ob-module-config')?.scrollIntoView?.({ block: 'start' })
                } }, '配置'),
                h(Btn, { kind: item.enabled ? 'danger' : 'secondary', busy: busy === item.id + ':toggle', disabled: Boolean(busy) || Boolean(cardOperation && !operationTerminal(cardOperation)) || !item.canToggle, 'aria-describedby': primaryToggleReasonId, onClick: () => action(item, 'toggle') }, item.enabled ? '停用' : '启用'),
              ),
              h('p', { className: 'ob-module-consequences' },
                h('span', { id: primaryConfigReasonId }, !(hasConfigUi(item, ui) || hasLegacyConfigUi(item, ui)) ? '暂无配置。' : busy ? '正在处理操作。' : '未运行时配置只读。'), ' ',
                h('span', { id: primaryToggleReasonId }, !item.canToggle ? (!item.builtin ? '启停需修改清单并重载。' : '当前不可启停。') : busy || (cardOperation && !operationTerminal(cardOperation)) ? '操作正在处理中。' : item.enabled ? '停用会停止任务并影响依赖。' : '启用可恢复调度、调用模型或发送消息。')),
            ) : null,
          ),
          error ? h(Banner, { tone: 'err', message: error }) : null,
          uiError ? h(Banner, { tone: 'muted', message: uiError }) : null,
          cardOperationStatus,
          item ? h(Fragment, null,
            h(Panel, { key: item.id + ':summary', className: 'ob-module-summary', title: '模块概况', description: String(item.description || '暂无说明') },
              metadataRows({ source: item.builtin && item.source === 'builtin' ? '内置受信任' : '外部', version: item.version, status: moduleStatusLabel(item.status) }, ['source', 'version', 'status'], { labels: { source: '来源', version: '版本', status: '状态' }, code: false }),
              item.error ? h('p', { className: 'ob-field-error' }, '模块加载失败，请查看技术信息并检查配置与依赖。') : null,
              item.configWarning ? h('p', { className: 'ob-muted ob-small' }, '配置需要检查，请查看技术信息。') : null,
              h('details', { className: 'ob-module-technical' }, h('summary', null, '技术信息'),
                metadataRows({ ...item, ...(healthSnapshot?.moduleId === item.id ? { runtimeGeneration: healthSnapshot.runtimeGeneration, telemetryGeneration: healthSnapshot.telemetryGeneration, observedAt: healthSnapshot.observedAt } : {}) }, ['id', 'generation', 'uiRevision', 'runtimeGeneration', 'telemetryGeneration', 'observedAt', 'requires', 'permissions']),
                item.error ? h('p', { className: 'ob-field-error' }, String(item.error)) : null,
                item.configWarning ? h('p', { className: 'ob-muted ob-small' }, String(item.configWarning)) : null,
              ),
            ),
            h(CoreModuleHealth, { ...props, key: item.id + ':' + item.generation + ':health:' + healthRevision, moduleId: item.id, onSnapshot: receiveHealth }),
            h(CoreModuleActions, { ...props, key: item.id + ':actions', moduleId: item.id, actionIds: ['module.restart', 'module.reload', ...(item.enabled && ['error', 'blocked'].includes(item.status) ? ['module.enable'] : []), 'proactivity.runOnce', 'learning.runPending'], onSettled: refresh }),
            h(ModuleFeatureLinks, { ...props, item }),
            item.id === 'builtin-reminders' && item.builtin && item.source === 'builtin' ? h('section', { id: 'ob-module-reminders' }, h(ReminderData, props)) : null,
            !ui || !ui.surfaces.length ? h('p', { className: 'ob-muted ob-small' }, 'UI 描述不可用或未声明，显示核心模块信息。')
              : ui.surfaces.map((surface) => {
                  const content = renderSurface(item, ui, surface)
                  const ownsPanel = content.type === MediaFeaturesPanel
                  return h('div', { key: surface.id, id: 'ob-module-' + (surface.hook === 'module.config' ? 'config' : surface.hook === 'module.panel' ? 'panel' : 'surface-' + surface.id) }, ownsPanel ? content : h(Panel, null, content))
                }),
            hasConfigUi(item, ui) && editor?.id === item.id ? h('div', { className: 'ob-module-savebar', role: 'group', 'aria-label': '模块配置保存工具栏' },
              h(Btn, { small: true, busy: busy === item.id + ':save', disabled: Boolean(busy) || !editor.schema || configReadOnly(item), onClick: saveModuleConfig }, '保存配置'),
              h(Btn, { small: true, kind: 'secondary', disabled: Boolean(busy), onClick: () => openConfig(item) }, '重新加载配置'),
              h(Btn, { small: true, kind: 'secondary', disabled: Boolean(busy), onClick: () => { setEditor(null); setConfigError('') } }, '取消'),
            ) : null,
          ) : h(Banner, { tone: 'muted', message: '模块已不在目录中，请返回列表。' }),
        )
      }
      return h(
        'div',
        { ref: landingRef, className: 'ob-stack ob-module-scope' },
        h(Panel, { title: '模块目录', description: '内置模块随插件发布；外部模块是操作员安装的同进程代码。permissions 不是沙箱，请先审核外部代码。', actions: h(Btn, { small: true, kind: 'secondary', icon: 'refresh', busy: loading, disabled: Boolean(busy) || loading, onClick: refresh }, '刷新') },
          h('div', { className: 'ob-row' }, h(Badge, { tone: 'muted' }, '内置 ' + items.filter((item) => item.builtin).length), h(Badge, { tone: 'muted' }, '外部 ' + items.filter((item) => !item.builtin).length)),
        ),
        error ? h(Banner, { tone: 'err', message: error, actions: [h(Btn, { key: 'retry', small: true, kind: 'secondary', onClick: refresh }, '重试')] }) : null,
        uiError ? h(Banner, { tone: 'muted', message: uiError }) : null,
        cardOperationStatus,
        items.length
          ? h('div', { className: 'ob-module-list' }, h('div', { className: 'ob-module-grid' }, items.map((item) => {
              const permissions = safeArray(item.permissions)
              const tone = item.status === 'loaded' ? 'ok' : (item.status === 'error' || item.status === 'blocked') ? 'err' : 'muted'
              const ui = uiFor(item)
              return h('article', {
                key: item.id, className: 'ob-module-card', 'aria-label': '模块卡片 · ' + String(item.name || item.id),
                onClick: (event) => { if (!event.target.closest('button, a, input, select, textarea')) openDetail(item) },
              }, h(Panel, {
                title: String(item.name || item.id),
                description: String(item.description || '暂无说明'),
                actions: h('span', { className: 'ob-module-status ' + tone, role: 'img', 'aria-label': moduleStatusLabel(item.status) }, h('i', { className: 'ob-dot', 'aria-hidden': true })),
                footer: h('div', { className: 'ob-module-actions' },
                  h(Btn, { small: true, kind: 'primary', disabled: Boolean(busy), onClick: () => openDetail(item) }, '详情'),
                  h(Btn, { small: true, kind: 'secondary', disabled: Boolean(busy) || !(hasConfigUi(item, ui) || hasLegacyConfigUi(item, ui)), 'aria-describedby': !(hasConfigUi(item, ui) || hasLegacyConfigUi(item, ui)) ? 'ob-module-config-' + item.id + '-reason' : undefined, onClick: () => openDetail(item, 'config') }, '配置'),
                  h(Btn, { small: true, kind: 'danger', 'aria-describedby': !item.canToggle && !item.builtin ? 'ob-module-toggle-' + item.id + '-reason' : undefined, busy: busy === item.id + ':toggle', disabled: Boolean(busy) || !item.canToggle, onClick: () => action(item, 'toggle') }, item.enabled ? '停用' : '启用'),
                ),
              },
                h('div', { className: 'ob-row' },
                  h(Badge, { tone: item.builtin ? 'brand' : 'muted' }, item.builtin ? '内置' : '外部'),
                  h(Badge, { tone }, moduleStatusLabel(item.status)),
                  item.version ? h(Badge, { tone: 'muted' }, 'v' + String(item.version)) : null,
                  h(Badge, { tone: item.enabled ? 'brand' : 'muted' }, item.enabled ? '已启用' : '已停用'),
                ),
                permissions.length ? h('div', { className: 'ob-module-permissions', 'aria-label': '权限摘要' }, permissions.slice(0, 3).map((permission) => h(Badge, { key: permission, tone: 'muted' }, permission)), permissions.length > 3 ? h(Badge, { tone: 'muted', key: 'more' }, '+' + (permissions.length - 3)) : null) : h('p', { className: 'ob-muted ob-small', style: { marginTop: '12px' } }, '未申请权限'),
                item.status === 'blocked' ? h('p', { className: 'ob-muted ob-small' }, '依赖未就绪，请在详情查看。') : null,
                !(hasConfigUi(item, ui) || hasLegacyConfigUi(item, ui)) ? h('p', { id: 'ob-module-config-' + item.id + '-reason', className: 'ob-sr-only' }, '此模块暂无可用配置界面') : null,
                !item.canToggle && !item.builtin ? h('p', { id: 'ob-module-toggle-' + item.id + '-reason', className: 'ob-module-action-reason ob-muted ob-small' }, '请编辑外部清单并重载后启停') : null,
                item.error ? h('p', { className: 'ob-field-error' }, '加载失败，请在详情查看原因。') : null,
                item.configWarning ? h('p', { className: 'ob-muted ob-small' }, '配置需要检查，请查看详情。') : null,
                ui?.surfaces.filter((surface) => surface.hook === 'module.card').map((surface) => renderSurface(item, ui, surface)),
              ))
            })))
          : h(Panel, null, h(EmptyState, {
              icon: 'layout',
              title: '还没有模块',
              description: '外部模块由操作员安装到 <dataDir>/modules/<id>，重启或通过 API 按 ID 重载后可见。内置模块使用静态目录；此页不提供安装功能。',
              action: h('a', { className: 'ob-btn secondary', href: 'https://github.com/reina0721/dsh-bot/blob/main/docs/MODULES.md', target: '_blank', rel: 'noreferrer' }, '查看模块文档'),
            })),
      )
    }

    // =====================================================================
    // 根组件：外观偏好 → data-* 属性、页头、标签栏、内容转场、全局反馈
    // =====================================================================

    function configInfoFromPayload(payload) {
      const data = safeObject(payload)
      return {
        ...data,
        config: safeObject(data.config),
        defaults: safeObject(data.defaults),
        groups: safeArray(data.groups),
        version: data.version,
        apiVersion: data.apiVersion,
        dataDir: data.dataDir,
      }
    }

    function pageHeaderFor(tab, status) {
      const brand = status?.brand || BRAND
      const gateway = safeObject(status && status.gateway)
      const connected = gateway.state === 'connected'
      const connecting = gateway.state === 'connecting'
      const login = isPlainObject(gateway.login) ? gateway.login : null
      switch (tab) {
        case 'connect':
          return {
            eyebrow: 'CONNECTION',
            title: '连接',
            description: '连接已有 OneBot v11 正向 WS / HTTP 地址，或只读 SnowLuma 自己的配置；插件不下载、不启动、不注入任何网关。',
          }
        case 'messages':
          return {
            eyebrow: 'MESSAGES & EVENTS',
            title: '消息',
            description: '向私聊 / 群聊发送文本，并实时观察收到的 QQ 事件。发送只调用 OneBot 的 send_private_msg / send_group_msg 接口。',
          }
        case 'media':
          return {
            eyebrow: 'MEDIA LIBRARY',
            title: '媒体',
            description: '查看图片理解、语音转写与合成状态，测试 TTS，并管理可按标签随机发送的本地表情包库。',
          }
        case 'content':
          return {
            eyebrow: 'PUBLIC CONTENT',
            title: '内容',
            description: '查询 B站公开搜索、热门和视频基本信息；QQ空间因需要登录授权暂未实现。',
          }
        case 'modules':
          return {
            eyebrow: 'LOCAL MODULES',
            title: '模块',
            description: '管理操作员放入本地数据目录的 JavaScript 模块。模块是任意本地代码；此页只支持查看、启停和热重载。',
          }
        case 'security':
          return { eyebrow: 'SECURITY & LAUNCH', title: '安全', description: '查看访问控制、危险面与上线检查清单，并按需查询 GitHub Release 版本。' }
        case 'backup':
          return { eyebrow: 'BACKUP & SECURITY', title: '备份', description: '创建、查看和删除本地目录快照；恢复默认暂存，检查后停止 DSH 再替换文件并重启。备份含密钥，请保护好数据目录。' }
        case 'config':
          return {
            eyebrow: 'PREFERENCES',
            title: '配置',
            description: '所有配置项都来自服务端字段表；左侧分组切换只替换右侧内容。改动后点底部「保存」或按 Ctrl + S；外观偏好已移到「系统设置」。',
          }
        case 'logs':
          return {
            eyebrow: 'DIAGNOSTICS',
            title: '日志',
            description: '增量拉取宿主日志环形缓冲；token 与密钥已在服务端脱敏。',
          }
        case 'persona':
          return {
            eyebrow: 'PERSONA STUDIO',
            title: '人格',
            description: '用自然语言编辑固定人设、说话风格与边界，并决定 bot 在群聊里的参与方式。文本会进入分析与回复 prompt。',
          }
        case 'models':
          return {
            eyebrow: 'MODEL GATEWAY',
            title: '模型',
            description: '统一接入 OpenAI Chat/Responses、Anthropic、Gemini、Ollama 与 OpenCode Go、Command Code、OpenRouter 等中转；直连与 DSH 路由可切换。',
          }
        case 'settings':
          return {
            eyebrow: 'SYSTEM SETTINGS',
            title: '系统设置',
            description: '面板外观与动效偏好，以及 DSH 全局主题。分类切换只替换右侧内容，页头与导航保持不动。',
          }
        case 'cognition':
          return {
            eyebrow: 'COGNITIVE CORE',
            title: '认知',
            description: '人格、人物、关系、记忆、情绪、策略、学习与元认知。所有状态持久化、可追溯、可暂停/删除；LLM 只做语义投影，不持有长期状态。',
          }
        case 'about':
          return {
            eyebrow: 'ABOUT',
            title: '关于 dsh-bot',
            description: 'DeepSeek Harness 的 OneBot v11 QQ 接入插件：连接管理、事件规范化与缓冲、消息发送、完整网页面板与持久化配置。',
          }
        default:
          return {
            eyebrow: `ONEBOT V11 · ${brand}`,
            title: brand,
            description: connected
              ? '连接正常' + (login && login.nickname ? '（登录账号 ' + String(login.nickname) + '）' : '') + '，面板会实时刷新 QQ 事件、核验状态与日志。'
              : connecting
                ? '正在建立 WebSocket 连接并核验登录账号，请稍候…'
                : '通过 OneBot v11 连接 NapCat / SnowLuma / Lagrange / LLOneBot，并在这里观察连接与事件状态。',
          }
      }
    }

    function OneBotPage() {
      usePanelStyle()
      const [tab, setTab] = useState(() => readNavigationUrl(window.location?.href || '').area)
      const [status, setStatus] = useState(null)
      const [configInfo, setConfigInfo] = useState(null)
      const [draft, setDraft] = useState(null)
      const [loading, setLoading] = useState(true)
      const [refreshing, setRefreshing] = useState(false)
      const [error, setError] = useState('')
      const [toastMessage, setToastMessage] = useState(null)
      const [saving, setSaving] = useState(false)
      const [issues, setIssues] = useState([])
      const [busyCount, setBusyCount] = useState(0)
      const [prefStatus, setPrefStatus] = useState({ saving: false, error: '', savedAt: 0 })
      const [configTarget, setConfigTarget] = useState('')
      const [navigation, setNavigation] = useState(() => readNavigationUrl(window.location?.href || ''))
      const historyRef = useRef(null)
      const rootRef = useRef(null), lastNavigationRef = useRef(null), focusPendingRef = useRef(false)

      const draftRef = useRef(null)
      const configInfoRef = useRef(null)
      const dirtyRef = useRef(false)
      const saveRef = useRef(null)
      const toastTimer = useRef(null)
      const errorDismissedRef = useRef(false)
      const lastErrorRef = useRef('')
      const prefQueueRef = useRef(Promise.resolve())
      const prefPendingRef = useRef(0)

      const systemReduced = useSystemReducedMotion()
      const systemMoreContrast = useSystemMoreContrast()
      const uiPrefs = useMemo(() => {
        const ui = safeObject((draft && draft.ui) || (configInfo && configInfo.config && configInfo.config.ui))
        return normalizeUiPreferences(ui)
      }, [draft, configInfo])
      const motion = useMemo(() => {
        const mode = resolveMotionMode(uiPrefs.motion, systemReduced)
        return { mode, systemReduced, categories: motionCategories(mode) }
      }, [uiPrefs.motion, systemReduced])
      const rootData = useMemo(() => uiRootData(uiPrefs, systemReduced, systemMoreContrast), [uiPrefs, systemReduced, systemMoreContrast])
      const now = useNow(5000)
      const progress = useTrickleProgress(Boolean(loading || refreshing || saving || prefStatus.saving || busyCount > 0), motion)

      const dirty = useMemo(() => Boolean(configInfo && draft) && !deepEqual(draft, configInfo.config), [draft, configInfo])
      dirtyRef.current = dirty
      configInfoRef.current = configInfo
      draftRef.current = draft

      const toast = useCallback((text, kind) => {
        const value = String(text == null ? '' : text).trim() || '操作完成'
        const tone = kind === 'ok' || kind === 'err' ? kind : 'info'
        setToastMessage({ text: value, kind: tone, uid: Date.now() + '-' + Math.random() })
        if (toastTimer.current) clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToastMessage(null), 3600)
      }, [])

      useEffect(
        () => () => {
          if (toastTimer.current) clearTimeout(toastTimer.current)
        },
        [],
      )

      const showError = useCallback((message) => {
        const text = String(message == null ? '' : message).trim()
        if (!text) return
        if (errorDismissedRef.current && text === lastErrorRef.current) return
        errorDismissedRef.current = false
        lastErrorRef.current = text
        setError(text)
      }, [])

      const clearError = useCallback(() => {
        errorDismissedRef.current = true
        setError('')
      }, [])

      const runWithProgress = useCallback(async (task) => {
        setBusyCount((value) => value + 1)
        try {
          return await task()
        } finally {
          setBusyCount((value) => Math.max(0, value - 1))
        }
      }, [])

      const loadConfig = useCallback(async () => {
        const parsed = parseApiResponse(await get('/config'))
        if (!parsed.ok) return { ok: false, message: parsed.message }
        const info = configInfoFromPayload(parsed.data)
        setConfigInfo(info)
        configInfoRef.current = info
        if (!dirtyRef.current) {
          setDraft(clone(info.config))
          draftRef.current = clone(info.config)
        }
        return { ok: true }
      }, [])

      const refreshStatus = useCallback(async () => {
        const parsed = parseApiResponse(await get('/status'))
        if (!parsed.ok) {
          showError(parsed.message)
          return false
        }
        const data = parsed.data
        setStatus(data)
        errorDismissedRef.current = false
        lastErrorRef.current = ''
        setError('')
        return true
      }, [showError])

      const refreshAll = useCallback(async () => {
        setRefreshing(true)
        try {
          await Promise.all([refreshStatus(), loadConfig()])
        } finally {
          setRefreshing(false)
        }
      }, [refreshStatus, loadConfig])

      useEffect(() => {
        let alive = true
        ;(async () => {
          setLoading(true)
          const results = await Promise.all([get('/status'), get('/config')])
          if (!alive) return
          const statusParsed = parseApiResponse(results[0])
          const configParsed = parseApiResponse(results[1])
          if (statusParsed.ok) {
            setStatus(statusParsed.data)
            errorDismissedRef.current = false
            lastErrorRef.current = ''
            setError('')
          } else {
            showError(statusParsed.message)
          }
          if (configParsed.ok) {
            const info = configInfoFromPayload(configParsed.data)
            setConfigInfo(info)
            configInfoRef.current = info
            setDraft(clone(info.config))
            draftRef.current = clone(info.config)
          } else if (!statusParsed.ok) {
            showError(configParsed.message)
          }
          setLoading(false)
        })()
        return () => {
          alive = false
        }
      }, [])

      const refreshMs = useMemo(() => computeRefreshMs(configInfo && configInfo.config, configInfo && configInfo.groups), [configInfo])

      useEffect(() => {
        if (loading) return undefined
        let alive = true
        const timer = setInterval(() => {
          if (!alive || pageHidden()) return
          refreshStatus()
        }, refreshMs)
        const onVisibility = () => {
          if (!pageHidden()) refreshStatus()
        }
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
        return () => {
          alive = false
          clearInterval(timer)
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [loading, refreshMs, refreshStatus])

      const updateDraft = useCallback((updater) => {
        setDraft((previous) => {
          const next = typeof updater === 'function' ? updater(previous) : updater
          draftRef.current = next
          dirtyRef.current = true
          return next
        })
      }, [])

      const undo = useCallback(() => {
        const info = configInfoRef.current
        if (info) { setDraft(clone(info.config)); draftRef.current = clone(info.config); dirtyRef.current = false }
      }, [])
      const lastPatchRef = useRef(null)
      const saveUiPatch = useCallback((patch) => {
        lastPatchRef.current = patch
        const run = async () => {
          const entries = Object.entries(patch)
          const fields = entries.map(([path]) => SETTINGS_FIELDS.find(field => field.path === path))
          const scopes = new Set(fields.map(field => field?.ownerClass === 'module' ? 'module:' + field.canonical.moduleId : field?.ownerClass))
          if (scopes.size !== 1 || fields.some(field => !field || field.ownerClass === 'profile')) { toast('SETTINGS_MULTI_OWNER', 'err'); return false }
          const scope = [...scopes][0]
          setPrefStatus({ saving: true, error: '', savedAt: 0 })
          try {
            const view = await get('/settings/view?scope=' + encodeURIComponent(scope))
            if (!view.ok) throw Error(view.code || 'SETTINGS_READ_UNAVAILABLE')
            const result = await post('/settings/patch', { scope, revision: view.revision, patch })
            if (!result.ok) throw Error(result.code || 'SETTINGS_WRITE_UNAVAILABLE')
            await loadConfig()
            setPrefStatus({ saving: false, error: '', savedAt: Date.now() }); return true
          } catch (error) { setPrefStatus({ saving: false, error: error.message, savedAt: 0 }); toast(error.message, 'err'); return false }
        }
        const pending = prefQueueRef.current.then(run, run)
        prefQueueRef.current = pending.catch(() => {})
        return pending
      }, [loadConfig, toast])

      const retryPrefSave = useCallback(() => { if (lastPatchRef.current) return saveUiPatch(lastPatchRef.current) }, [saveUiPatch])
      const applyGateway = useCallback((gateway) => {
        if (!isPlainObject(gateway)) return
        setStatus((previous) => (previous ? Object.assign({}, previous, { gateway }) : previous))
      }, [])

      const gatewayAction = useCallback(
        async (name, label) => {
          const actionLabel = label || (name === 'connect' ? '连接' : name === 'disconnect' ? '断开' : '重连')
          return runWithProgress(async () => {
            const parsed = parseApiResponse(await post('/' + name))
            if (!parsed.ok) {
              toast(actionLabel + '失败：' + parsed.message, 'err')
              return { ok: false, message: parsed.message }
            }
            if (parsed.data && isPlainObject(parsed.data.gateway)) applyGateway(parsed.data.gateway)
            toast(actionLabel + '成功', 'ok')
            refreshStatus()
            return { ok: true }
          })
        },
        [applyGateway, refreshStatus, toast, runWithProgress],
      )

      const acceptNavigation = useCallback(next => { setNavigation(next); setTab(next.area); setConfigTarget('') }, [])
      useEffect(() => {
        if (!window.location || !window.history) return
        historyRef.current = createNavigationHistory(window, acceptNavigation)
        return () => { historyRef.current?.dispose(); historyRef.current = null }
      }, [acceptNavigation])
      const goTo = useCallback(target => {
        if (historyRef.current) historyRef.current.navigate(target)
        else acceptNavigation(navigationTarget(target))
      }, [acceptNavigation])
      const go = useCallback((id, group = '') => {
        const target = resolveLegacyGo(id, group)
        goTo(target)
      }, [goTo])

      const navigationKey = JSON.stringify(navigation)
      const initialLoading = loading && !status && !configInfo
      useLayoutEffect(() => {
        const root = rootRef.current, bar = root?.querySelector('.ob-commandbar')
        if (!bar) return
        const measure = () => root.style.setProperty('--ob-commandbar-height', bar.getBoundingClientRect().height + 'px')
        measure()
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
        observer?.observe(bar)
        return () => observer?.disconnect()
      }, [])
      useLayoutEffect(() => {
        const root = rootRef.current
        if (!root) return
        if (lastNavigationRef.current !== navigationKey) {
          lastNavigationRef.current = navigationKey
          root.scrollTop = 0
          focusPendingRef.current = true
        }
        if (!initialLoading && focusPendingRef.current) {
          const heading = root.querySelector('#ob-page-title')
          if (heading) { heading.focus({ preventScroll: true }); focusPendingRef.current = false }
        }
      }, [navigationKey, initialLoading])

      const gateway = safeObject(status && status.gateway)
      const version = (configInfo && configInfo.version) || (status && status.version) || ''
      const areaDescriptions = { overview: '连接、事件与运行概况。', chat: '消息管理与离线模拟。', profiles: '人格设置与认知数据。', extensions: '模块目录、状态与配置。', data: '媒体、事件、日志与数据治理。', system: '连接、运行与全局设置。' }
      const headerInfo = { eyebrow: NAVIGATION_REGISTRY.find(area => area.id === navigation.area)?.label || 'Overview', title: SECTION_LABELS[navigation.section] || '模块详情', description: navigation.moduleId || areaDescriptions[navigation.area] }

      const tabProps = {
        configTarget,
        navigation,
        goTo,
        status,
        configInfo,
        draft,
        updateDraft,
        toast,
        go,
        gatewayAction,
        refreshAll,
        refreshStatus,
        runWithProgress,
        saving,
        dirty,
        issues,
        undo,
        saveUiPatch,
        saveConfigPatch: saveUiPatch,
        retryPrefSave,
        prefStatus,
        now,
      }

      const body = h(AreaContent, tabProps)

      const loadingShell =
        initialLoading
          ? h(
              'div',
              { className: 'ob-page' },
              h(
                'div',
                { className: 'ob-header' },
                h(
                  'div',
                  { className: 'ob-header-main' },
                  h(Skeleton, { variant: 'text', width: '96px' }),
                  h(Skeleton, { variant: 'title', width: 'min(420px, 62%)', style: { marginTop: '4px', height: '26px' } }),
                  h(Skeleton, { variant: 'text', width: 'min(560px, 84%)', style: { marginTop: '4px' } }),
                ),
              ),
              h('div', { className: 'ob-stat-grid' }, [0, 1, 2, 3, 4].map((index) => h(StatSkeleton, { key: index }))),
              h('div', { className: 'ob-grid two' }, h(PanelSkeleton, { rows: 4 }), h(PanelSkeleton, { rows: 4 })),
            )
          : null

      return h(
        MotionContext.Provider,
        { value: motion },
        h(
          'div',
          Object.assign({ className: 'ob-root', ref: rootRef }, rootData),
          h(
            'div',
            { className: 'ob-shell' },
            h(CommandBar, { navigation, goTo, configInfo, gateway, version, dirty, refreshAll, refreshing }),
            h('div', { className: 'ob-destination', 'aria-labelledby': initialLoading ? undefined : 'ob-page-title' }, loadingShell
              ? loadingShell
              : h(
                  'div',
                  { className: cx('ob-page', navigation.area === 'extensions' && navigation.moduleId && 'ob-module-detail-page') },
                  error
                    ? h(Banner, {
                        tone: 'err',
                        message: error,
                        actions: [
                          h(Btn, { key: 'retry', small: true, kind: 'secondary', onClick: () => refreshAll(), busy: refreshing }, '重试'),
                          h(IconBtn, { key: 'close', small: true, title: '关闭提示', label: '关闭提示', icon: 'close', onClick: clearError }),
                        ],
                      })
                    : null,
                  navigation.area === 'extensions' && navigation.moduleId ? null : h(PageHeader, {
                    eyebrow: headerInfo.eyebrow,
                    title: headerInfo.title,
                    description: headerInfo.description,
                  }),
                  h(TopProgress, { phase: progress }),
                  h(
                    'div',
                    {
                      className: 'ob-content',
                      id: 'ob-panel-' + navigation.area + '-' + navigation.section,
                      role: 'region',
                      'aria-label': headerInfo.title,
                    },
                    h('div', { key: navigation.area + ':' + navigation.section, className: pageTransitionClass(contentTransitionFor(tab, uiPrefs.pageTransition)) }, body),
                  ),
                )),
          ),
          h(Toast, { message: toastMessage }),
        ),
      )
    }

    // =====================================================================
    // apply：注入样式 + 注册两个 slot
    // =====================================================================

    function apply(ctx) {
      try {
        applyImpl(ctx)
      } catch (error) {
        // 注册失败会让客户端 entry 变成 failed（DSH boot 页只显示 "failed"），
        // 这里补一条可读的浏览器控制台错误，便于定位。
        try {
          console.error('[dsh-bot] 面板注册失败：', error)
        } catch (inner) {}
        throw error
      }
    }

    function applyImpl(ctx) {
      if (!ctx) return
      installStyle(ctx)
      bindClientTheme(ctx)
      let slots = null
      try {
        slots = typeof ctx.get === 'function' ? ctx.get('slots') : undefined
      } catch (error) {
        slots = undefined
      }
      if (!slots) slots = ctx.slots
      if (!slots || typeof slots.inject !== 'function') return
      slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, OneBotPage))
      slots.inject('sidebar.panellist', () => slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => BRAND }, OneBotIcon))
    }

    // ---- 导出（apply/inject 给 DSH，其余给测试） ----
    exports.inject = inject
    exports.apply = apply
    exports.PANEL_ID = PANEL_ID
    exports.API_PREFIX = API
    exports.STYLE_ID = STYLE_ID
    exports.TOKEN_CSS = TOKEN_CSS
    exports.MOTION_CSS = MOTION_CSS
    exports.PANEL_CSS = PANEL_CSS
    exports.NAVIGATION_REGISTRY = NAVIGATION_REGISTRY
    exports.SETTINGS_FIELDS = SETTINGS_FIELDS
    exports.resolveLegacyGo = resolveLegacyGo
    exports.resolveAlias = resolveAlias
    exports.readNavigationUrl = readNavigationUrl
    exports.navigationUrl = navigationUrl
    exports.createNavigationHistory = createNavigationHistory
    exports.searchNavigation = searchNavigation
    exports.navigationSearchIndex = navigationSearchIndex
    exports.ownerFields = ownerFields
    exports.OwnerSettings = OwnerSettings
    exports.PageHeader = PageHeader
    exports.CommandBar = CommandBar
    exports.SandboxChat = SandboxChat
    exports.AreaContent = AreaContent
    exports.TABS = TABS
    exports.OneBotPage = OneBotPage
    exports.OneBotIcon = OneBotIcon
    exports.Overview = Overview
    exports.Connect = Connect
    exports.Messages = Messages
    exports.MediaPage = MediaPage
    exports.MediaFeaturesPanel = MediaFeaturesPanel
    exports.ContentPage = ContentPage
    exports.navigationTarget = navigationTarget
    exports.MODULE_DESTINATIONS = MODULE_DESTINATIONS
    exports.CoreModuleHealth = CoreModuleHealth
    exports.CoreModuleActions = CoreModuleActions
    exports.ModuleFeatureLinks = ModuleFeatureLinks
    exports.ReminderData = ReminderData
    exports.CogProactivity = CogProactivity
    exports.CogLearning = CogLearning
    exports.CogPolicy = CogPolicy
    exports.CogLoop = CogLoop
    exports.LoopDetail = LoopDetail
    exports.invokeModuleAction = invokeModuleAction
    exports.pollModuleOperation = pollModuleOperation
    exports.operationSucceeded = operationSucceeded
    exports.loopStatus = loopStatus
    exports.ModulesPage = ModulesPage
    exports.SandboxModuleFrame = SandboxModuleFrame
    exports.attachSandboxBridge = attachSandboxBridge
    exports.BackupPage = BackupPage
    exports.SecurityPage = SecurityPage
    // 注意：这里刻意导出为 ConfigTab（而不是 Config）。Cordis 把插件对象的 `Config`
    // 属性当作配置 schema，会调用 Config['~standard'].validate；面板组件若叫 Config，
    // 客户端插件激活时会直接崩溃（实测踩坑，见 test/panel.test.js 的回归用例）。
    exports.ConfigTab = ConfigTab
    exports.SettingsTab = SettingsTab
    exports.SettingsShell = SettingsShell
    exports.ModelTab = ModelTab
    exports.CognitionTab = CognitionTab
    exports.CogBudgetCard = CogBudgetCard
    exports.CogSettings = CogSettings
    exports.CogPersons = CogPersons
    exports.CogRelationships = CogRelationships
    exports.CogMemories = CogMemories
    exports.CogTimeline = CogTimeline
    exports.PersonaTab = PersonaTab
    exports.COG_SECTIONS = COG_SECTIONS
    exports.Logs = Logs
    exports.About = About
    exports.UI_ACCENTS = UI_ACCENTS
    exports.UI_DENSITIES = UI_DENSITIES
    exports.UI_FONT_SCALES = UI_FONT_SCALES
    exports.UI_CONTENT_WIDTHS = UI_CONTENT_WIDTHS
    exports.UI_MOTION_MODES = UI_MOTION_MODES
    exports.UI_PAGE_TRANSITIONS = UI_PAGE_TRANSITIONS
    exports.UI_CONTRASTS = UI_CONTRASTS
    exports.DEFAULT_UI = DEFAULT_UI
    exports.THEME_OPTIONS = THEME_OPTIONS
    exports.SETTINGS_CATEGORY_DEFS = SETTINGS_CATEGORY_DEFS
    exports.ACCENT_TOKENS = ACCENT_TOKENS
    exports.DENSITY_METRICS = DENSITY_METRICS
    exports.resolveMotionMode = resolveMotionMode
    exports.resolveContrast = resolveContrast
    exports.motionCategories = motionCategories
    exports.motionDisabled = motionDisabled
    exports.shouldAnimate = shouldAnimate
    exports.revealDelayMs = revealDelayMs
    exports.countUpValue = countUpValue
    exports.easeOutCubic = easeOutCubic
    exports.nextPresence = nextPresence
    exports.pageTransitionClass = pageTransitionClass
    exports.contentTransitionFor = contentTransitionFor
    exports.BUILTIN_MODULE_UI = BUILTIN_MODULE_UI
    exports.applyConfigPatch = applyConfigPatch
    exports.settingsSections = settingsSections
    exports.accentValues = accentValues
    exports.fontScalePercent = fontScalePercent
    exports.densityMetrics = densityMetrics
    exports.contentMaxWidth = contentMaxWidth
    exports.normalizeUiPreferences = normalizeUiPreferences
    exports.uiRootData = uiRootData
    exports.splitBufferValue = splitBufferValue
    exports.formatCount = formatCount
    exports.formatNumberList = formatNumberList
    exports.bindClientTheme = bindClientTheme
    exports.clampNumber = clampNumber
    exports.deepEqual = deepEqual
    exports.getByPath = getByPath
    exports.setByPath = setByPath
    exports.clone = clone
    exports.formatTime = formatTime
    exports.formatDateTime = formatDateTime
    exports.formatDuration = formatDuration
    exports.formatRelative = formatRelative
    exports.truncateText = truncateText
    exports.maskEndpoint = maskEndpoint
    exports.buildQuery = buildQuery
    exports.parseApiResponse = parseApiResponse
    exports.mergeConfigSave = mergeConfigSave
    exports.normalizeFieldSpec = normalizeFieldSpec
    exports.buildFieldSpecs = buildFieldSpecs
    exports.flattenFieldSpecs = flattenFieldSpecs
    exports.fieldSpecByPath = fieldSpecByPath
    exports.defaultsFromGroups = defaultsFromGroups
    exports.computeRefreshMs = computeRefreshMs
    exports.stateLabel = stateLabel
    exports.loginCheckLabel = loginCheckLabel
    exports.endpointModeLabel = endpointModeLabel
    exports.accountCheckLabel = accountCheckLabel
    exports.eventKindLabel = eventKindLabel
    exports.describeEvent = describeEvent
    exports.normalizeFriend = normalizeFriend
    exports.normalizeGroup = normalizeGroup
    exports.normalizeLogEntry = normalizeLogEntry
    exports.mergeIncremental = mergeIncremental
    exports.nextSince = nextSince
    exports.probeEndpointFromDraft = probeEndpointFromDraft
    exports.describeProbe = describeProbe
    exports.describeDetect = describeDetect
    exports.FIELD_TYPES = FIELD_TYPES
    exports.LOG_LEVELS = LOG_LEVELS
    exports.EVENT_KINDS = EVENT_KINDS
    exports.REFRESH_MIN = REFRESH_MIN
    exports.REFRESH_MAX = REFRESH_MAX
    return module.exports
  },
})
