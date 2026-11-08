// The DSH client is a single loader file; embed the pure shared contract verbatim.
import fs from 'node:fs'
import * as schema from '../src/core/settings-schema.js'
const names = ['DEFAULT_TARGET', 'NAVIGATION_REGISTRY', 'LEGACY_ALIASES', 'LEGACY_TABS', 'LEGACY_COGNITION_SECTIONS', 'LEGACY_CONFIG_GROUPS', 'LEGACY_MODULE_IDS', 'LEGACY_ANCHORS', 'LEGACY_SETTINGS_SECTIONS', 'SETTINGS_FIELDS']
const source = fs.readFileSync(new URL('../src/core/navigation.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/import \{[\s\S]*?\} from '.\/settings-schema.js'\n/, '').replace(/export /g, '').replace(/\bgo\(/g, 'resolveLegacyGo(')
const block = '    // BEGIN SHARED NAVIGATION (scripts/sync-client-navigation.mjs)\n' + names.map(name => `    const ${name} = ${JSON.stringify(schema[name])}\n`).join('') + '    const isCanonicalDestination = target => NAVIGATION_REGISTRY.some(area => area.id === target?.area && area.sections.some(section => section.id === target.section))\n' + source.split('\n').map(line => line ? '    ' + line : '').join('\n') + '\n    // END SHARED NAVIGATION'
const path = new URL('../client.js', import.meta.url)
const client = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
const next = client.includes('// BEGIN SHARED NAVIGATION') ? client.replace(/    \/\/ BEGIN SHARED NAVIGATION[\s\S]*?    \/\/ END SHARED NAVIGATION/, block) : client.replace('    function clone(value)', block + '\n\n    function clone(value)')
if (process.argv.includes('--check')) { if (next !== client) throw Error('Run node scripts/sync-client-navigation.mjs') }
else fs.writeFileSync(path, next)
