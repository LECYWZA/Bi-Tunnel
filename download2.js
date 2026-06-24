const https = require('https');
const fs = require('fs');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        return download(response.headers.location, dest).then(resolve).catch(reject);
      }
      const file = fs.createWriteStream(dest);
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function main() {
  try {
    console.log('Downloading vue...');
    await download('https://npm.elemecdn.com/vue@3.3.4/dist/vue.global.prod.js', 'src/web/public/vue.global.js');
    console.log('Downloading tailwind script...');
    await download('https://npm.elemecdn.com/tailwindcss-cdn@3.4.10/tailwindcss.js', 'src/web/public/tailwind.js');
    console.log('Done!');
  } catch(e) {
    console.error('Failed', e);
  }
}
main();
