const fs = require('fs');

const outputPath = process.argv[2];
const triggerPath = process.argv[3];

fs.writeFileSync(outputPath, JSON.stringify({
  rpcPort: process.env.HOSTRA_RPC_PORT || null,
  cdpPort: process.env.HOSTRA_CDP_PORT || null
}));

const timer = setInterval(() => {
  if (fs.existsSync(triggerPath)) {
    clearInterval(timer);
    process.exit(0);
  }
}, 25);
