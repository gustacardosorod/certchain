// Deploy na Sepolia: npx hardhat run scripts/deploy.js --network sepolia
const { ethers, network } = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Rede:", network.name);
  console.log("Deployer:", deployer.address);
  console.log("Saldo:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  const F = await ethers.getContractFactory("CertificadoVerificavel");
  const contrato = await F.deploy();
  await contrato.waitForDeployment();
  const endereco = await contrato.getAddress();
  const rec = await contrato.deploymentTransaction().wait();

  console.log("Contrato implantado em:", endereco);
  console.log("Tx de deploy:", rec.hash);
  console.log("Gas usado:", rec.gasUsed.toString());
  console.log("Preço do gas (gwei):", ethers.formatUnits(rec.gasPrice, "gwei"));
  console.log("Custo (ETH de teste):", ethers.formatEther(rec.gasUsed * rec.gasPrice));

  fs.writeFileSync(
    "deployment.json",
    JSON.stringify({ rede: network.name, endereco, txDeploy: rec.hash, gasUsado: rec.gasUsed.toString(), bloco: rec.blockNumber }, null, 2)
  );
  console.log("\nVerifique com:\n  npx hardhat verify --network sepolia " + endereco);
}

main().catch((e) => { console.error(e); process.exit(1); });
