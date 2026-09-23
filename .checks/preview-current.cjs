'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {releaseInfo}=require('../scripts/build-updates.cjs');
const current=releaseInfo();
const out=path.join(__dirname,'poetry-screen');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const errors=[],report={completed:false};
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://10.48.201.6:8765/#poetry');await page.locator('[data-poetry-id]').first().waitFor();
    await page.screenshot({path:path.join(out,'current-ip-catalog.png')});
    await page.locator('#poetrySearch').fill('静夜思');await page.locator('#poetrySearch').press('Enter');await page.locator('[data-poetry-id="ts-011"]').click();await page.locator('[data-poetry-verse="0"]').waitFor();
    await page.screenshot({path:path.join(out,'current-ip-reader.png')});await page.locator('#poetryExplainTab').click();await page.locator('#poetryExplanation [data-poetry-fragment]').first().waitFor();
    await page.screenshot({path:path.join(out,'current-ip-explanation.png')});
    await page.locator('#backHome').click();await page.locator('#homeCheckUpdate').click();await page.waitForFunction(()=>!document.getElementById('dialogCheckUpdate').disabled);
    report.update=await (await page.request.get('http://10.48.201.6:8765/api/app/update')).json();
    report.versionText=await page.locator('#updateStatus').textContent();assert.ok(report.versionText.includes('v'+report.update.versionName));assert.ok((await page.locator('#updateCurrentVersion').textContent()).includes(current.versionName));assert.equal(await page.locator('.brand-name').textContent(),'童趣学堂');
    await page.screenshot({path:path.join(out,'current-ip-update.png')});await page.locator('#closeUpdateDialog').click();await page.screenshot({path:path.join(out,'current-ip-home.png')});
    delete report.update.notes;
    report.completed=true;assert.deepEqual(errors,[]);console.log(JSON.stringify({...report,errors}));
  }finally{await browser.close();fs.writeFileSync(path.join(out,'current-ip-report.json'),JSON.stringify({...report,errors},null,2));}
})().catch(e=>{console.error(e);process.exitCode=1;});
