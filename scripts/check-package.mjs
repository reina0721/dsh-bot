import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
process.chdir(resolve(import.meta.dirname,'..'));
const work = mkdtempSync(join(tmpdir(),'dsh-bot-check-'));
try {
  const sums = readFileSync('dist/SHA256SUMS','utf8');
  for (const [format,folder] of [['tgz','package'],['zip','dsh-bot']]) {
    const archive = resolve(`dist/dsh-bot.${format}`);
    assert.ok(sums.includes(`${createHash('sha256').update(readFileSync(archive)).digest('hex')}  dsh-bot.${format}\n`));
    // Windows ships bsdtar; Linux uses unzip for ZIP.
    if(format === 'zip' && process.platform !== 'win32') execFileSync('unzip',['-q',archive,'-d',work]);
    else execFileSync('tar',['-xf',archive,'-C',work]);
    const base = join(work,folder), pkg = JSON.parse(readFileSync(join(base,'package.json'),'utf8'));
    assert.equal(pkg.name,'dsh-bot'); assert.equal(pkg.version, JSON.parse(readFileSync('package.json')).version);
    for (const file of ['src/modules/health.js', 'src/modules/actions.js', 'src/modules/action-audit.js', 'src/observability/loop.js', 'src/observability/loop-query.js', 'docs/architecture/ADR-018-module-closed-loop.md', 'docs/architecture/ADR-019-system-closed-loop.md', 'docs/architecture/CLOSED-LOOP-ACCEPTANCE.md']) readFileSync(join(base, file));
    assert.equal(pkg.dsh.client.platform, 'web');
    // UI phase 5: design docs are already whitelisted; tests stay source-only.
    for (const file of ['client.js', 'docs/design/responsive-navigation-modules.md', 'docs/USER-MANUAL.md', 'docs/README.md', 'README.md', 'CHANGELOG.md']) {
      assert.deepEqual(readFileSync(join(base, file)), readFileSync(file), `Packaged responsive UI file differs: ${file}`);
    }
    const alignmentFiles = [
      'src/services/assembly.js', 'src/http/sandbox-chat.js',
      'src/simulation/service.js', 'src/simulation/adapters.js', 'src/simulation/preview-contract.js',
      'src/core/settings-schema.js', 'src/core/profile-settings.js', 'src/core/navigation.js',
      'src/runtime/sandbox-tools.js', 'src/sandbox/service.js', 'src/sandbox/policy.js',
      'src/sandbox/workspace.js', 'src/sandbox/drivers/local-linux.js', 'src/sandbox/drivers/local-macos.js',
      'src/sandbox/drivers/unavailable.js', 'src/sandbox/bootstrap.js', 'src/sandbox/file-worker.js',
      'src/sandbox/driver-contract.js', 'src/sandbox/audit.js', 'src/sandbox/api.js',
      'docs/architecture/ADR-020-settings-ownership-navigation.md',
      'docs/architecture/ADR-021-simulation-service.md',
      'docs/architecture/ADR-022-agent-execution-broker.md',
      'docs/architecture/ASTRBOT-ALIGNMENT-ACCEPTANCE.md',
    ];
    for (const file of alignmentFiles) assert.deepEqual(readFileSync(join(base, file)), readFileSync(file), `Packaged alignment file differs: ${file}`);
    const settings = await import(pathToFileURL(join(base, 'src/core/settings-schema.js')).href);
    const profiles = await import(pathToFileURL(join(base, 'src/core/profile-settings.js')).href);
    assert.equal(typeof profiles.createProfileSettings, 'function');
    assert.equal(profiles.PROFILE_RUNTIME_MODE, 'profile');
    const navigation = await import(pathToFileURL(join(base, 'src/core/navigation.js')).href);
    assert.deepEqual(settings.validateSettingsSchema(), { fields: 311, groups: 32, aliases: 620 });
    assert.deepEqual(navigation.go('config'), { area: 'system', section: 'general' });
    assert.deepEqual(navigation.go('cognition'), { area: 'profiles', section: 'overview' });
    // Execute the shipped client entry with a Node shim; this is not a browser check.
    let entry;
    runInNewContext(readFileSync(join(base, 'client.js'), 'utf8'), {
      window: { __ModuleLoader__: { load(value) { assert.equal(entry, undefined); entry = value; } } },
    });
    const client = entry.factory(name => {
      assert.equal(name, 'react');
      return { createElement() {}, createContext: () => ({}), Component: class {}, Fragment: 'fragment' };
    });
    for (const name of ['SandboxChat', 'OwnerSettings', 'AreaContent', 'CommandBar', 'PageHeader', 'searchNavigation', 'readNavigationUrl', 'navigationUrl', 'CoreModuleHealth', 'CoreModuleActions', 'CogLoop', 'LoopDetail', 'invokeModuleAction', 'pollModuleOperation', 'navigationTarget']) assert.equal(typeof client[name], 'function', `Packaged client missing ${name}`);
    assert.equal(client.NavigationMenu, undefined);
    assert.match(client.PANEL_CSS, /\.ob-commandbar\{position:sticky;top:0/);
    assert.doesNotMatch(client.PANEL_CSS, /ob-area-shell|ob-navigation|ob-nav-dialog|grid-template-columns:(?:240|72)px/);
    assert.deepEqual(Array.from(client.TABS, tab => tab.id), ['overview', 'chat', 'profiles', 'extensions', 'data', 'system']);
    for (const [alias] of Object.entries(settings.LEGACY_ALIASES)) assert.equal(JSON.stringify(client.resolveLegacyGo(alias)), JSON.stringify(navigation.go(alias)), alias);
    for (const field of settings.SETTINGS_FIELDS) {
      for (const alias of field.aliases) assert.equal(JSON.stringify(client.resolveLegacyGo(alias)), JSON.stringify(navigation.go(alias)), alias);
      assert.ok(client.searchNavigation(field.path).some(row => row.target.fieldPath === field.path), field.path);
    }
    const registrations = [];
    const slots = { inject(name, register) { register(); }, register(def) { registrations.push({ name: def.name, id: def.key || def.id }); } };
    client.apply({ get: name => name === 'slots' ? slots : undefined, effect() {} });
    assert.deepEqual(registrations, [{ name: 'main', id: 'onebot-qq' }, { name: 'sidebar.panellist', id: 'onebot-qq' }]);
    for(const file of ['docs/architecture/ADR-017-builtin-learning.md','src/cognition/research.js','src/modules/learning-port.js','src/modules/builtin/learning/index.js','src/modules/builtin/learning/engine.js','docs/architecture/ADR-016-builtin-proactivity.md','src/modules/proactivity-port.js','src/modules/builtin/proactivity/index.js','src/modules/builtin/proactivity/engine.js','src/modules/webui.js','docs/architecture/ADR-014-module-webui.md','docs/architecture/ADR-015-builtin-media-features.md','src/modules/media-features-port.js','src/modules/builtin/media-features/index.js','src/modules/builtin/media-features/bilibili.js','src/modules/builtin/media-features/commands.js']) readFileSync(join(base,file));
    for(const file of ['docs/ARCHITECTURE.md','docs/MODULES.md','docs/cognitive/IMPLEMENTATION-STATUS.md','docs/architecture/ADR-013-media-boundary.md','docs/architecture/MODULE-ACCEPTANCE.md']) readFileSync(join(base,file));
    for(const file of ['src/host.js','src/cognition/turn-hooks.js','src/modules/manifest.js','src/modules/dependencies.js','src/modules/registry.js','src/modules/builtin/reminders.js','src/reminders/service.js','src/reminders/commands.js','src/modules/builtin/typing.js','src/modules/builtin/sample.js','src/modules/builtin/reply-delivery.js','src/modules/builtin/reply-delivery-plan.js','src/delivery/registry.js','src/delivery/text-split.js','client.js','cordis.patch.yml','locale/zh.json','locale/en.json','icon.svg','README.md','LICENSE','THIRD_PARTY_NOTICES.md']) readFileSync(join(base,file));
    function scan(dir) { for(const entry of readdirSync(dir,{withFileTypes:true})) {
      const file = join(dir,entry.name);
      assert.ok(!/^(node_modules|test|verification|verify-out|\.git|\.env|dist|\.archify|\.builtin|plugins-data)$/.test(entry.name),file);
      assert.ok(!/^(state|config|data|operations|sessions)\.json$/.test(entry.name), `Private module state: ${file}`);
      assert.ok(!/\.(png|sqlite(?:-wal|-shm)?|db|log|tmp|jsonl|pem|key)$/.test(entry.name),file);
      assert.ok(!/^\.env(?:\.|$)/.test(entry.name), `Environment file: ${file}`);
      if(entry.isDirectory())scan(file);
      else if(/\.(js|json|md|yml|ps1|sh|html|svg)$/.test(entry.name)) {
        const content = readFileSync(file, 'utf8');
        assert.ok(!/[A-Za-z]:[\\/]Users[\\/][^\\/\s<>]+|C:[\\/]rin[\\/]coder|\/Users\/[^/\s]+|\/home\/(?!plugins-data(?:\/|$))[^/\s]+/.test(content), `Personal path: ${file}`);
        assert.ok(!content.includes(process.cwd()), `Build workspace path: ${file}`);
        assert.ok(!/-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----\s+[A-Za-z0-9+/=]{32,}|\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,}|sk-proj-[A-Za-z0-9_-]{40,})\b/.test(content), `Credential material: ${file}`);
      }
      if(entry.name.endsWith('.md')) for(const match of readFileSync(file,'utf8').matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
        const url=match[1];
        if(!/^(https?:|mailto:|#)/.test(url))assert.ok(existsSync(resolve(dirname(file),decodeURIComponent(url.split('#')[0]))),`Broken packaged link: ${file}: ${url}`);
      }
    }} scan(base);
    execFileSync(process.execPath,['--input-type=module','-e',`const p = await import(${JSON.stringify(pathToFileURL(join(base,'src/host.js')).href)}); if(p.PLUGIN_ID !== 'dsh-bot')process.exit(1)`],{stdio:'pipe'});
    execFileSync(process.execPath,['--input-type=module','-e',`
      import assert from 'node:assert/strict';
      import { mkdtemp, rm } from 'node:fs/promises';
      import { tmpdir } from 'node:os';
      import { join } from 'node:path';
      const { builtinRegistry } = await import(${JSON.stringify(pathToFileURL(join(base,'src/modules/registry.js')).href)});
      const { createModuleKernel } = await import(${JSON.stringify(pathToFileURL(join(base,'src/modules/kernel.js')).href)});
      const root = await mkdtemp(join(tmpdir(), 'dsh-pack-modules-'));
      const { createDeliveryRegistry } = await import(${JSON.stringify(pathToFileURL(join(base,'src/delivery/registry.js')).href)});
      const deliveryRegistry = createDeliveryRegistry();
      const { createTurnHooks } = await import(${JSON.stringify(pathToFileURL(join(base,'src/cognition/turn-hooks.js')).href)});
      const turnHooks = createTurnHooks();
      const statuses = [];
      const gateway = { actions: { setInputStatus: (id, event) => statuses.push([id, event]) } };
      const { createProviderRegistry } = await import(${JSON.stringify(pathToFileURL(join(base,'src/extensions/providers.js')).href)});
      const providerRegistry = createProviderRegistry();
      let calls = 0;
      const kernel = createModuleKernel({ dataDir: root, registry: builtinRegistry, providerRegistry, deliveryRegistry, turnHooks, gateway, commands: {
        registerCommand(name, handler, options) {
          if (['bili', 'sticker'].includes(name)) { assert.equal(options.allowProtected, true); assert.equal(options.audience, name === 'bili' ? 'owner-or-operator' : 'owner'); return () => {}; }
          if (['remind', 'reminders', 'forgetreminder'].includes(name)) { assert.equal(options.allowProtected, true); assert.equal(options.ownerOnly, true); return () => {}; }
          assert.equal(name, 'module-sample'); assert.equal(options.ownerOnly, true);
          assert.equal(handler(), '内置示例模块已启用。'); calls++; return () => {};
        }
      } });
      try {
        const items = await kernel.start();
        assert.deepEqual(items.map(item => item.id), ['builtin-learning', 'builtin-media-features', 'builtin-proactivity', 'builtin-reminders', 'builtin-reply-delivery', 'builtin-sample', 'builtin-typing']);
        assert.equal(items.length, 7); assert.equal(items.find(item => item.id === 'builtin-sample').status, 'disabled'); assert.equal(calls, 0);
        const ui = kernel.uiCatalog();
        assert.equal(ui.version, 1); assert.equal(ui.items.length, 7);
        for (const item of ui.items) {
          assert.equal(item.trust, 'builtin'); assert.equal(item.surfaces.length, item.moduleId === 'builtin-media-features' ? 3 : 2);
          assert.equal(item.uiWarning, ''); assert.deepEqual(item.grantedCapabilities, []);
          assert.equal(item.generation, items.find(row => row.id === item.moduleId).generation);
          assert.equal(item.config.binding, item.moduleId === 'builtin-sample' ? 'module-file' : 'legacy-core');
        }
        const management = JSON.stringify([ui, kernel.health(), ...items.map(item => kernel.actions(item.id))]);
        assert.ok(!management.includes(JSON.stringify(root).slice(1, -1)), 'Private module path in packaged management projection');
        assert.doesNotMatch(management, /"(?:moduleDir|entryPath|configValues|dbFile)"/);
        assert.deepEqual(kernel.uiCatalog(), ui);
        const learning = items.find(item => item.id === 'builtin-learning');
        assert.equal(learning.status, 'loaded'); assert.ok(providerRegistry.get('learning'));
        await kernel.setEnabled(learning.id, false); assert.equal(providerRegistry.get('learning'), null);
        assert.equal((await kernel.setEnabled(learning.id, true)).status, 'loaded');
        const proactive = items.find(item => item.id === 'builtin-proactivity');
        assert.equal(proactive.status, 'loaded'); assert.ok(providerRegistry.get('proactivity'));
        await kernel.setEnabled(proactive.id, false); assert.equal(providerRegistry.get('proactivity'), null);
        const media = items.find(item => item.id === 'builtin-media-features');
        assert.equal(media.status, 'loaded'); assert.ok(providerRegistry.get('mediaFeatures'));
        await kernel.setEnabled(media.id, false); assert.equal(providerRegistry.get('mediaFeatures'), null);
        const reminders = items.find(item => item.id === 'builtin-reminders');
        assert.equal(reminders.status, 'loaded'); assert.equal(reminders.enabled, true); assert.equal(reminders.hasConfig, false);
        assert.ok(providerRegistry.get('reminders'));
        await kernel.setEnabled(reminders.id, false); assert.equal(providerRegistry.get('reminders'), null);
        const typing = items.find(item => item.id === 'builtin-typing');
        assert.equal(typing.status, 'loaded'); assert.equal(typing.enabled, true); assert.equal(typing.hasConfig, false);
        const context = { turn: { chatType: 'private', chatId: '123' }, settings: { typingEnabled: true } };
        await turnHooks.start(context); await turnHooks.end(context);
        assert.deepEqual(statuses, [['123', 1], ['123', 2]]);
        await kernel.setEnabled(typing.id, false);
        assert.equal(turnHooks.list().length, 0);
        await turnHooks.start(context); await turnHooks.end(context);
        assert.equal(statuses.length, 2);
        const reply = items.find(item => item.id === 'builtin-reply-delivery');
        assert.equal(reply.status, 'loaded'); assert.equal(reply.hasConfig, false);
        assert.equal(deliveryRegistry.resolve('format').id, reply.id);
        assert.equal((await kernel.setEnabled(reply.id, false)).status, 'disabled');
        assert.equal(deliveryRegistry.resolve('format'), null);
        assert.equal((await kernel.setEnabled('builtin-sample', true)).status, 'loaded'); assert.equal(calls, 1);
      } finally { await kernel.dispose(); await rm(root, {recursive:true,force:true}); }
    `],{stdio:'pipe'});
    execFileSync(process.execPath,['--check',join(base,'client.js')]);
  }
  console.log('Both archives verified: checksums, responsive UI docs/client and AstrBot alignment files/ADR-020/021/022/acceptance match source, exhaustive aliases, exactly two DSH registrations, credential/private state/path scan, links and standalone module loading (Node shim; no browser).');
} finally { rmSync(work,{recursive:true,force:true}); }
