cat > scripts/testar-env.js <<'EOF'

const { ethers } = require("hardhat");

const ok = (m) => console.log("✅", m);
const falha = (m) => { console.log("❌", m); process.exitCode = 1; };

async function main() {
  const { SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY } = process.env;

  // 1. Variáveis presentes e no formato certo
  SEPOLIA_RPC_URL?.startsWith("https://") ? ok("SEPOLIA_RPC_URL definida") : falha("SEPOLIA_RPC_URL ausente ou não começa com https://");
  /^0x[0-9a-fA-F]{64}$/.test(PRIVATE_KEY || "") ? ok("PRIVATE_KEY no formato correto (0x + 64 caracteres)") : falha("PRIVATE_KEY ausente ou inválida (precisa de 0x + 64 caracteres hexadecimais)");
  ETHERSCAN_API_KEY ? ok("ETHERSCAN_API_KEY definida") : falha("ETHERSCAN_API_KEY ausente");
  if (process.exitCode) return;

  // 2. RPC responde e é a Sepolia
  const net = await ethers.provider.getNetwork();
  net.chainId === 11155111n ? ok(`RPC conectado na Sepolia (chainId ${net.chainId}), bloco ${await ethers.provider.getBlockNumber()}`) : falha(`RPC está na rede errada (chainId ${net.chainId}). Esperado: 11155111`);

  // 3. Carteira e saldo
  const [conta] = await ethers.getSigners();
  const saldo = await ethers.provider.getBalance(conta.address);
  ok(`Carteira: ${conta.address}`);
  saldo > 0n ? ok(`Saldo: ${ethers.formatEther(saldo)} ETH`) : falha("Saldo zero: peça ETH em um faucet da Sepolia");

  // 4. Chave do Etherscan válida
  const url = `https://api.etherscan.io/v2/api?chainid=11155111&module=account&action=balance&address=${conta.address}&tag=latest&apikey=${ETHERSCAN_API_KEY}`;
  const r = await (await fetch(url)).json();
  r.status === "1" ? ok("ETHERSCAN_API_KEY válida") : falha(`Etherscan recusou a chave: ${r.result || r.message}`);
}

main().catch((e) => { console.log("❌ Erro:", e.message); process.exit(1); });
EOF