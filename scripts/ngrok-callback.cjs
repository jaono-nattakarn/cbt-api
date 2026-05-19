const fs = require("fs");
const path = require("path");
const ngrok = require("@ngrok/ngrok");

const rootDir = path.resolve(__dirname, "..");
const envPath = path.join(rootDir, ".env");

function readEnvFile() {
  if (!fs.existsSync(envPath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

function upsertEnv(key, value) {
  const nextLine = `${key}=${value}`;
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, `${nextLine}\n`);
    return;
  }
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index >= 0) {
    lines[index] = nextLine;
  } else {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push(nextLine);
  }
  fs.writeFileSync(envPath, lines.join("\n"));
}

async function main() {
  const fileEnv = readEnvFile();
  const port = Number(process.env.PORT || fileEnv.PORT || 4000);
  const token = process.env.NGROK_AUTHTOKEN || fileEnv.NGROK_AUTHTOKEN || process.argv[2];

  if (!token) {
    throw new Error("Missing NGROK_AUTHTOKEN. Run: $env:NGROK_AUTHTOKEN='<token>'; npm run tunnel:ngrok");
  }

  const listener = await ngrok.forward({ addr: port, authtoken: token });
  const publicUrl = listener.url();
  const callbackUrl = `${publicUrl}/api/v1/integrations/n8n/analysis-results`;
  upsertEnv("N8N_CALLBACK_URL", callbackUrl);

  console.log(`ngrok tunnel: ${publicUrl}`);
  console.log(`N8N_CALLBACK_URL=${callbackUrl}`);
  console.log("Keep this process running while testing n8n callbacks.");
  console.log("Restart the API after this script updates .env, then upload/retry a new analysis job.");

  async function shutdown() {
    await listener.close();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.resume();
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
