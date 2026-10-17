// nodejs-mobile entry point (started by NodeServerService).
// Reads the per-launch config the plugin wrote, sets env, then imports the bundle.
const fs = require('node:fs');
const path = require('node:path');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'embedded-config.json'), 'utf8'));
process.env.OPENCODE_SERVER_PASSWORD = cfg.password; // bundle must honor this (see README)
process.env.POC_DB = cfg.dbPath;
process.env.OPENCODE_CONFIG_DIR = cfg.configDir;
process.env.NODE_ENV = 'production';

require('./main.js');
