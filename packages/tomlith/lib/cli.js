#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const toml_1 = require("./toml");
const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
    console.log(`tomlith — parse a TOML file and print JSON to stdout

Usage:
  tomlith <file.toml>
  tomlith --help

Example:
  tomlith ./config.toml`);
    process.exit(0);
}
const file = args.find((a) => !a.startsWith('-'));
if (!file) {
    console.error('Usage: tomlith <file.toml>');
    process.exit(1);
}
try {
    console.log(JSON.stringify((0, toml_1.readToml)(file), null, 2));
}
catch (err) {
    console.error(err);
    process.exit(1);
}
