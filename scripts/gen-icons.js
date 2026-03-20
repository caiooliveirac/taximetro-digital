const fs = require("fs");

// Minimal valid 1x1 PNG (navy blue pixel) as placeholder
// Real icons should be designed and replaced before production
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

fs.writeFileSync("public/icons/icon-192.png", PNG_1x1);
fs.writeFileSync("public/icons/icon-512.png", PNG_1x1);
console.log("PWA placeholder icons created");
