// XXX even though ethers is not used in the code below, it's very likely
// it will be used by any DApp, so we are already including it here
const { ethers } = require("ethers");
const { Wallet } = require("cartesi-wallet");

const rollup_server = process.env.ROLLUP_HTTP_SERVER_URL;
console.log("HTTP rollup_server url is " + rollup_server);

let wallet = new Wallet(new Map());

async function handle_advance(data) {
  console.log("Received advance request data " + JSON.stringify(data));
  if (data.metadata.msg_sender.toLowerCase() == "0x9C21AEb2093C32DDbC53eEF24B873BDCd1aDa1DB".toLowerCase()) { // It means it is a deposit
    let output = wallet.erc20_deposit_process(data.payload)
    await fetch(rollup_server + "/notice", {
      method: "POST", headers: { "Content-Type": "application/json", },
      body: JSON.stringify({ payload: output.payload }),
    });

  } else { // Means is a generic input
    let input = data.payload
    let str = Buffer.from(input.substr(2), "hex").toString("utf8")
    let json = JSON.parse(str)

    if (json.method == "toupper") {
      let text = json.text.toUpperCase()
      let hex = "0x" + Buffer.from(text, "utf8").toString("hex")
      await fetch(rollup_server + "/notice", {
        method: "POST", headers: { "Content-Type": "application/json", },
        body: JSON.stringify({ payload: hex }),
      });

    } else if (json.method == "transfer") {
      let notice = wallet.erc20_transfer(json.from, json.to, json.erc20, BigInt(json.amount))
      await fetch(rollup_server + "/notice", {
        method: "POST", headers: { "Content-Type": "application/json", },
        body: JSON.stringify({ payload: notice.payload }),
      });
    
    } else if (json.method == "withdraw") {
      try {
        let voucher = wallet.erc20_withdraw(json.from, json.erc20, BigInt(json.amount))
        await fetch(rollup_server + "/voucher", {
          method: "POST", headers: { "Content-Type": "application/json", },
          body: JSON.stringify({ payload: voucher.payload, destination: voucher.destination }),
        });
      } catch (error) {
        console.log(error)
      }
    
    }
  }

  return "accept";
}

async function handle_inspect(data) {
  console.log("Received inspect request data " + JSON.stringify(data));
  let str = Buffer.from(data.payload.substr(2), "hex").toString("utf8")
  str = str.replace("balance/", "")
  if (str.startsWith("erc20")) {
    let info = str.split("/")
    let balance = wallet.balance_get(info[1])
    let tokens = (balance.erc20_get(info[2]) || 0).toString()
    let hex = "0x" + Buffer.from(JSON.stringify({"token": info[2], "amount": tokens}), "utf8").toString("hex")
    const finish_req = await fetch(rollup_server + "/report", {
      method: "POST", headers: { "Content-Type": "application/json", },
      body: JSON.stringify({payload: hex}),
    });
  }

  return "accept";
}

var handlers = {
  advance_state: handle_advance,
  inspect_state: handle_inspect,
};

var finish = { status: "accept" };

(async () => {
  while (true) {
    const finish_req = await fetch(rollup_server + "/finish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "accept" }),
    });

    console.log("Received finish status " + finish_req.status);

    if (finish_req.status == 202) {
      console.log("No pending rollup request, trying again");
    } else {
      const rollup_req = await finish_req.json();
      var handler = handlers[rollup_req["request_type"]];
      finish["status"] = await handler(rollup_req["data"]);
    }
  }
})();
