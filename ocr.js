import Lens from 'chrome-lens-ocr';
import fs from 'fs';
import path from 'path';

const imagePath = process.argv[2];

if (!imagePath) {
    console.error('Please provide an image path');
    process.exit(1);
}

const targetLanguage = process.argv[3] !== undefined ? process.argv[3] : '';
const lens = new Lens({ targetLanguage });

lens.scanByFile(imagePath).then(data => {
    const parsedPath = path.parse(imagePath);
    const jsonPath = path.join(parsedPath.dir, `${parsedPath.name}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
}).catch(console.error);

/*
nvm exec 24 node a.js
/home/vagrant/frappe-bench/apps/veerpasli/a.js
*/