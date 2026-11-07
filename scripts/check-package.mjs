import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
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
    for(const file of ['src/modules/webui.js','docs/architecture/ADR-014-module-webui.md','docs/architecture/ADR-015-builtin-media-features.md','src/modules/media-features-port.js','src/modules/builtin/media-features/index.js','src/modules/builtin/media-features/bilibili.js','src/modules/builtin/media-features/commands.js']) readFileSync(join(base,file));
    for(const file of ['docs/ARCHITECTURE.md','docs/MODULES.md','docs/cognitive/IMPLEMENTATION-STATUS.md','docs/architecture/ADR-013-media-boundary.md','docs/architecture/MODULE-ACCEPTANCE.md']) readFileSync(join(base,file));
    for(const file of ['src/host.js','src/cognition/turn-hooks.js','src/modules/manifest.js','src/modules/dependencies.js','src/modules/registry.js','src/modules/builtin/reminders.js','src/reminders/service.js','src/reminders/commands.js','src/modules/builtin/typing.js','src/modules/builtin/sample.js','src/modules/builtin/reply-delivery.js','src/modules/builtin/reply-delivery-plan.js','src/delivery/registry.js','src/delivery/text-split.js','client.js','cordis.patch.yml','locale/zh.json','locale/en.json','icon.svg','README.md','LICENSE','THIRD_PARTY_NOTICES.md']) readFileSync(join(base,file));
    function scan(dir) { for(const entry of readdirSync(dir,{withFileTypes:true})) {
      const file = join(dir,entry.name);
      assert.ok(!/^(node_modules|test|verification|verify-out|\.git|\.env|dist)$/.test(entry.name),file);
      assert.ok(!/\.(png|sqlite|db|log|tmp)$/.test(entry.name),file);
      if(entry.isDirectory())scan(file);
      else if(/\.(js|json|md|yml|ps1|sh)$/.test(entry.name)) assert.ok(!/C:[\\/]Users[\\/]Run|C:[\\/]rin[\\/]coder/.test(readFileSync(file,'utf8')),`Personal path: ${file}`);
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
        assert.deepEqual(items.map(item => item.id), ['builtin-media-features', 'builtin-reminders', 'builtin-reply-delivery', 'builtin-sample', 'builtin-typing']);
        assert.equal(items.length, 5); assert.equal(items.find(item => item.id === 'builtin-sample').status, 'disabled'); assert.equal(calls, 0);
        const ui = kernel.uiCatalog();
        assert.equal(ui.version, 1); assert.equal(ui.items.length, 5);
        for (const item of ui.items) {
          assert.equal(item.trust, 'builtin'); assert.equal(item.surfaces.length, item.moduleId === 'builtin-media-features' ? 3 : 2);
          assert.equal(item.uiWarning, ''); assert.deepEqual(item.grantedCapabilities, []);
          assert.equal(item.generation, items.find(row => row.id === item.moduleId).generation);
          assert.equal(item.config.binding, item.moduleId === 'builtin-sample' ? 'module-file' : 'legacy-core');
        }
        assert.ok(!JSON.stringify(ui).includes(root));
        assert.deepEqual(kernel.uiCatalog(), ui);
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
  console.log('Both archives verified: checksums, contents and standalone module loading.');
} finally { rmSync(work,{recursive:true,force:true}); }
