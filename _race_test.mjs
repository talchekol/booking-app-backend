import { exec as execCb } from "child_process";
import { promisify } from "util";
import { execSync } from "child_process";

const exec = promisify(execCb);
const BASE = "http://localhost:5000";

const getCode = (phone) => {
  const out = execSync(`node _tmp_get_code.js ${phone}`).toString();
  return out.split("\n").map((l) => l.trim()).filter(Boolean).pop();
};

const curlJson = async (method, path, body, token) => {
  const headers = ['-H "Content-Type: application/json"'];
  if (token) headers.push(`-H "Authorization: Bearer ${token}"`);
  const dataArg = body ? `-d '${JSON.stringify(body)}'` : "";
  const cmd = `curl -s -w "\\nHTTP_STATUS:%{http_code}" -X ${method} ${BASE}${path} ${headers.join(" ")} ${dataArg}`;
  const { stdout } = await exec(cmd);
  const idx = stdout.lastIndexOf("HTTP_STATUS:");
  const status = parseInt(stdout.slice(idx + 12).trim(), 10);
  const bodyText = stdout.slice(0, idx);
  let json;
  try { json = JSON.parse(bodyText); } catch { json = bodyText; }
  return { status, json };
};

const loginClient = async (phone) => {
  await curlJson("POST", "/auth/send-sms", { phone });
  await new Promise((r) => setTimeout(r, 700));
  const code = getCode(phone);
  const res = await curlJson("POST", "/auth/verify-sms", { phone, code });
  return res.json.token;
};

const PROVIDER_ID = "370ceb9e-f9c9-47fc-af7f-975a0cd147e4"; // מוטי
const SERVICE_ID = "4f038b04-7084-47e6-8666-32b22c2b53e5"; // תספורת גבר
const BUSINESS_ID = "7b875e26-05d0-402c-954d-ec9e18846196"; // moti-cosmetic
const TARGET_DATETIME = "2026-09-26T18:00:00.000Z";

console.log("Logging in two fresh clients...");
const tokenC = await loginClient("0501112223");
const tokenD = await loginClient("0501112224");
console.log("token C len:", tokenC?.length, "token D len:", tokenD?.length);

const bookPayload = {
  dateTime: TARGET_DATETIME,
  businessId: BUSINESS_ID,
  providerId: PROVIDER_ID,
  serviceId: SERVICE_ID,
};

console.log("\nFiring both booking requests CONCURRENTLY for the exact same slot...");
const [resC, resD] = await Promise.all([
  curlJson("POST", "/appointments", bookPayload, tokenC),
  curlJson("POST", "/appointments", bookPayload, tokenD),
]);

console.log("\nClient C result:", resC.status, JSON.stringify(resC.json));
console.log("Client D result:", resD.status, JSON.stringify(resD.json));

const successCount = [resC.status, resD.status].filter((s) => s === 201).length;
console.log(`\n=== RESULT: ${successCount} out of 2 requests succeeded ===`);
if (successCount === 2) {
  console.log("BUG CONFIRMED: double-booking race condition - both requests created an appointment for the same slot!");
} else if (successCount === 1) {
  console.log("Correct: only one booking succeeded, the other was rejected.");
} else {
  console.log("Unexpected: neither request succeeded.");
}
