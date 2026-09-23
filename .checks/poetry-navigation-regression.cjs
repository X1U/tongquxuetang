'use strict';
// Compatibility entry point: navigation now uses measured screen pagination.
const {chromium}=require('playwright');
const {run}=require('./poetry-screen-regression.cjs');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{await run(browser);}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
