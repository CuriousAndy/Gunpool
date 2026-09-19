const baseUrl = process.env.FRONTEND_URL ?? "http://127.0.0.1:3000";

async function main() {
  const response = await fetch(`${baseUrl}/api/market-apy`, {
    method: "POST",
    headers: {
      accept: "application/json",
    },
  });

  const payloadText = await response.text();
  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    payload = payloadText;
  }

  if (!response.ok) {
    console.error("Market sync failed:");
    console.error(payload);
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
