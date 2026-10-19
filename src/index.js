import { ethers } from "ethers";

const USDT = "0x55d398326f99059fF775485246999027B3197955";
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)"
];

const paid = new Map();

function json(data, status) {
  status = status || 200;
  return new Response(JSON.stringify(data), {
    status: status,
    headers: { "Content-Type": "application/json" }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return json({ ok: true, service: "bsc-payout", network: "BSC" });
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "POST only" }, 405);
    }

    const url = new URL(request.url);
    if (url.pathname !== "/" && url.pathname !== "/payout") {
      return json({ ok: false, error: "Not found" }, 404);
    }

    var apiKey = request.headers.get("X-Api-Key") || "";
    if (!env.API_SECRET || apiKey !== env.API_SECRET) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    var body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    var to = String(body.to || "").trim();
    var amount = String(body.amount || "").trim();
    var withdraw_id = String(body.withdraw_id || "").trim();

    if (!ethers.isAddress(to)) {
      return json({ ok: false, error: "Invalid address" }, 400);
    }
    if (!withdraw_id || withdraw_id.length < 3) {
      return json({ ok: false, error: "withdraw_id required" }, 400);
    }
    var amt = Number(amount);
    if (!(amt > 0) || amt > 100000) {
      return json({ ok: false, error: "Invalid amount" }, 400);
    }

    if (paid.has(withdraw_id)) {
      return json({
        ok: false,
        error: "Already paid",
        txHash: paid.get(withdraw_id)
      }, 409);
    }

    if (!env.PAYOUT_PRIVATE_KEY || !env.BSC_RPC_URL) {
      return json({ ok: false, error: "Server not configured" }, 500);
    }

    try {
      var provider = new ethers.JsonRpcProvider(env.BSC_RPC_URL);
      var wallet = new ethers.Wallet(env.PAYOUT_PRIVATE_KEY, provider);
      var usdt = new ethers.Contract(USDT, ERC20_ABI, wallet);

      var value = ethers.parseUnits(amount, 18);
      var bal = await usdt.balanceOf(wallet.address);
      if (bal < value) {
        return json({ ok: false, error: "Insufficient USDT" }, 400);
      }

      var bnb = await provider.getBalance(wallet.address);
      if (bnb < ethers.parseEther("0.0003")) {
        return json({ ok: false, error: "Insufficient BNB for gas" }, 400);
      }

      var tx = await usdt.transfer(to, value);
      var receipt = await tx.wait();
      var txHash = receipt.hash || tx.hash;
      paid.set(withdraw_id, txHash);

      return json({
        ok: true,
        txHash: txHash,
        to: to,
        amount: amount,
        withdraw_id: withdraw_id,
        explorer: "https://bscscan.com/tx/" + txHash
      });
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      return json({ ok: false, error: msg.slice(0, 200) }, 500);
    }
  }
};
