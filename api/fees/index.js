const fs = require("fs");
const path = require("path");

module.exports = async function (context, req) {

  try {

    const filePath = path.join(__dirname, "../../feeSchedule.sample.csv");

    const csv = fs.readFileSync(filePath, "utf8");

    const lines = csv.split("\n").slice(1);

    const fees = lines
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {

        const [cpt, desc, amount] = line.split(",");

        return {
          cpt: cpt.trim(),
          desc: desc.trim(),
          fee: parseFloat(amount)
        };

      });

    context.res = {
      headers: { "Content-Type": "application/json" },
      body: fees
    };

  } catch (err) {

    context.log("Fee API error:", err);

    context.res = {
      status: 500,
      body: { error: "Could not load fee schedule" }
    };

  }

};
