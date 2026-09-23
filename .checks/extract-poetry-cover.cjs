'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const directory=path.resolve(__dirname,'../modules/poetry'),context={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(directory,'illustrations.js'),'utf8'),context);
const cover=context.window.PoetryArt.bookCover();assert.ok(cover.includes('viewBox="0 0 280 190"'));
fs.writeFileSync(path.join(directory,'cover.js'),'/* 首页唐诗入口封面。详情页不再使用诗意图。 */\nwindow.PoetryArt = Object.freeze({bookCover: () => '+JSON.stringify(cover)+'});\n','utf8');
console.log('Homepage cover retained; detail illustration code excluded from the application.');
