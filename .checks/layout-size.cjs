'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const sizes = [{width:320,height:568},{width:360,height:640},{width:412,height:840}];
const sources = [
  {name:'previous-nine', file:'.checks/before-large-cards.html'},
  {name:'current', file:'app/src/main/assets/index.html'}
];
(async () => {
  const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const results = [];
  try {
    for (const source of sources) for (const viewport of sizes) {
      const page = await browser.newPage({viewport,reducedMotion:'reduce'});
      await page.goto(pathToFileURL(path.resolve(__dirname,'..',source.file)).href+'#sort');
      const metrics = await page.evaluate(() => {
        const sizes = selector => [...document.querySelectorAll(selector)].filter(el => el.getClientRects().length).map(el => {
          const rect=el.getBoundingClientRect(),view=el.viewBox?.baseVal;
          return {width:Math.round(rect.width*10)/10,height:Math.round(rect.height*10)/10,scale:view?Math.min(rect.width/view.width,rect.height/view.height):null};
        });
        return {goods:sizes('#goodsTray .art'),shelfIcons:sizes('#shelfGrid .shelf-icon .art'),workspace:sizes('.sort-workspace')};
      });
      results.push({source:source.name,viewport,...metrics});
      console.log(source.name+' '+viewport.width+'x'+viewport.height+' '+JSON.stringify(metrics));
      await page.close();
    }
    fs.writeFileSync(path.join(__dirname,'nine-goods-size-comparison.json'),JSON.stringify(results,null,2));
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
