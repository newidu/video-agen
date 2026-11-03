#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
const scriptPaths = [...html.matchAll(/<script src="([^"]+)"\s*><\/script>/g)].map(m => m[1]);
if (!scriptPaths.length) throw new Error('No ordered engine scripts found in ui/index.html');
const required = [
 '../src/skills/skill-manifest.js','../src/canvas/primitives.js','../src/canvas/scene-engine.js',
 '../src/editor/interaction.js','../src/features/fonts.js','../src/features/audio-music.js',
 '../src/editor/history-and-audit.js','../src/agent/session-and-skills.js','../src/agent/tools.js',
 '../src/agent/model-streaming-context.js','../src/agent/loop.js','../src/agent/spec-bridge-and-boot.js'
];
if (JSON.stringify(scriptPaths) !== JSON.stringify(required)) throw new Error('Script load order changed. Review ui/index.html and README.md.');
for (const relative of scriptPaths) {
  const file = path.resolve(root, 'ui', relative);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) throw new Error('Missing or unsafe script path: ' + relative);
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Syntax check failed: ${relative}\n${result.stderr || result.stdout}`);
}
const source = fs.readFileSync(path.join(root, 'original', 'source.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'skills', 'manifest.json'), 'utf8'));
for (const marker of ['function sendPrompt()', 'function syncSpec()', 'window.SKILL_FILES', 'window.SKILL_ORDER']) {
 if (!source.includes(marker)) throw new Error('Original source validation failed; missing ' + marker);
}
const sections = [
 [334,521,'src/canvas/primitives.js'], [522,970,'src/canvas/scene-engine.js'],
 [971,1966,'src/editor/interaction.js'], [1967,2018,'src/features/fonts.js'],
 [2019,2527,'src/features/audio-music.js'], [2528,2920,'src/editor/history-and-audit.js'],
 [2921,3368,'src/agent/session-and-skills.js'], [3369,3951,'src/agent/tools.js'],
 [3952,4189,'src/agent/model-streaming-context.js'], [4190,4373,'src/agent/loop.js'],
 [4374,4525,'src/agent/spec-bridge-and-boot.js']
];
const sourceLines = source.split(/\r?\n/);
for (const [start,end,file] of sections) {
 const actual = fs.readFileSync(path.join(root,file),'utf8').split(/\r?\n/).slice(1).join('\n');
 const expected = sourceLines.slice(start-1,end).join('\n') + '\n';
 if (actual !== expected) throw new Error('Extracted code differs from original source in ' + file);
}
const skillStart = source.indexOf('window.SKILL_FILES = ') + 'window.SKILL_FILES = '.length;
const skillEnd = source.indexOf(';\nwindow.SKILL_ORDER = ', skillStart);
const originalSkills = JSON.parse(source.slice(skillStart, skillEnd));
if (manifest.order.length !== Object.keys(originalSkills).length) throw new Error('Skill count mismatch against original HTML.');
for (const skill of manifest.order) {
 const skillFile = path.join(root, 'skills', skill);
 if (!fs.existsSync(skillFile)) throw new Error('Skill missing: ' + skill);
 if (fs.readFileSync(skillFile,'utf8') !== originalSkills[skill]) throw new Error('Skill content changed: ' + skill);
}
console.log(`OK: ${scriptPaths.length} ordered scripts; ${manifest.order.length} exact skill files; all engine chunks match original source.`);
