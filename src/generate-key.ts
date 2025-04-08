import { Wallet } from "ethers";

function generateNewWallet() {
  const wallet = Wallet.createRandom();

  console.log("🔑 New Ethereum Wallet Generated:");
  console.log("----------------------------------");
  console.log(`Address:       ${wallet.address}`);
  console.log(
    `Private Key:   ${wallet.privateKey}` // <<<--- VERY IMPORTANT: KEEP THIS SECRET AND SAFE!
  );
  console.log(`Mnemonic:      ${wallet.mnemonic?.phrase}`); // Optional but good backup
  console.log("----------------------------------");
  console.log(
    "🛑 IMPORTANT: Store the Private Key securely in your .env file as PK="
  );
  console.log("   NEVER share it or commit it to version control (like Git).");
  console.log("   Consider backing up the Mnemonic phrase as well.");
}

generateNewWallet();

// frequent appear must season connect velvet slice verb mystery scene sugar nice
