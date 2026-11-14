
const { ethers } = require("hardhat");

const hashDe = (t) => ethers.keccak256(ethers.toUtf8Bytes(t));

async function gas(tx) {
  const r = await (await tx).wait();
  return r.gasUsed;
}

async function main() {
  const [dono, emissor] = await ethers.getSigners();
  const F = await ethers.getContractFactory("CertificadoVerificavel");
  const c = await F.deploy();
  const deployRec = await c.deploymentTransaction().wait();

  const linhas = [];
  linhas.push(["Deploy do contrato", deployRec.gasUsed]);
  linhas.push(["adicionarEmissor", await gas(c.adicionarEmissor(emissor.address))]);
  linhas.push(["emitirCertificado (1 certificado)", await gas(c.emitirCertificado(hashDe("c1"), "Engenharia de Software"))]);

  const lote10 = Array.from({ length: 10 }, (_, i) => hashDe("l10-" + i));
  const g10 = await gas(c.emitirLote(lote10, "Engenharia de Software"));
  linhas.push(["emitirLote (10 certificados, total)", g10]);
  linhas.push(["emitirLote (10 certificados, por unidade)", g10 / 10n]);

  linhas.push(["revogarCertificado", await gas(c.revogarCertificado(hashDe("c1"), "Erro de emissão"))]);
  linhas.push(["removerEmissor", await gas(c.removerEmissor(emissor.address))]);
  linhas.push(["iniciarTransferenciaPropriedade", await gas(c.iniciarTransferenciaPropriedade(emissor.address))]);
  linhas.push(["aceitarPropriedade", await gas(c.connect(emissor).aceitarPropriedade())]);

  console.log("\n| Operação | Gas |\n|---|---:|");
  for (const [nome, g] of linhas) console.log(`| ${nome} | ${g.toString()} |`);
  console.log("\nverificarCertificado: função view, não consome gas quando chamada fora de transação.");
}

main().catch((e) => { console.error(e); process.exit(1); });
