
const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const endereco = process.env.CONTRACT_ADDRESS;
  if (!endereco) throw new Error("Defina CONTRACT_ADDRESS");
  const c = await ethers.getContractAt("CertificadoVerificavel", endereco);

  const conteudo = process.env.ARQUIVO
    ? fs.readFileSync(process.env.ARQUIVO)
    : ethers.toUtf8Bytes("Certificado demo " + Date.now());
  const hash = ethers.keccak256(conteudo);
  console.log("Hash do documento:", hash);

  const exibir = async (rotulo) => {
    const r = await c.verificarCertificado(hash);
    console.log(`[${rotulo}] válido=${r.valido} existe=${r.existe} revogado=${r.revogado} curso="${r.curso}"`);
  };

  await exibir("antes da emissão");

  let tx = await c.emitirCertificado(hash, "Engenharia de Software - UniSales");
  let rec = await tx.wait();
  console.log("emitirCertificado tx:", rec.hash, "| gas:", rec.gasUsed.toString());
  await exibir("após emissão");

  tx = await c.revogarCertificado(hash, "Demonstração de revogação");
  rec = await tx.wait();
  console.log("revogarCertificado tx:", rec.hash, "| gas:", rec.gasUsed.toString());
  await exibir("após revogação");
}

main().catch((e) => { console.error(e); process.exit(1); });
