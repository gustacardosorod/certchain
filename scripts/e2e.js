
//   PowerShell: $env:CONTRACT_ADDRESS="0x..."; npx hardhat run scripts/e2e.js --network sepolia

const { ethers, network } = require("hardhat");
const fs = require("fs");
const os = require("os");
const path = require("path");

let passou = 0;
let falhou = 0;
const ok = (m) => { passou++; console.log("  OK   " + m); };
const erro = (m) => { falhou++; console.log("  ERRO " + m); };
const checar = (cond, m) => (cond ? ok(m) : erro(m));
const secao = (t) => console.log("\n== " + t);

async function reverte(promessa, nomeErro, descricao) {
  try {
    await promessa;
    erro(`${descricao}: deveria reverter com ${nomeErro}, mas passou`);
  } catch (e) {
    const texto = [e.message, e.shortMessage, e.errorName, e.revert && e.revert.name].join(" ");
    checar(texto.includes(nomeErro), `${descricao}: reverteu com ${nomeErro}`);
  }
}

async function obterContrato() {
  if (network.name === "hardhat") {
    const F = await ethers.getContractFactory("CertificadoVerificavel");
    const c = await F.deploy();
    await c.waitForDeployment();
    return c;
  }
  let endereco = process.env.CONTRACT_ADDRESS;
  if (!endereco && fs.existsSync("deployment.json")) {
    endereco = JSON.parse(fs.readFileSync("deployment.json", "utf8")).endereco;
  }
  if (!endereco) throw new Error("Defina CONTRACT_ADDRESS ou tenha o deployment.json na pasta.");
  const codigo = await ethers.provider.getCode(endereco);
  if (codigo === "0x") throw new Error(`Nenhum contrato em ${endereco} na rede ${network.name}.`);
  return ethers.getContractAt("CertificadoVerificavel", endereco);
}

async function fluxoPrincipal(c, signer, estranho) {
  secao("Documento: arquivo -> hash");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "certchain-"));
  const arquivo = path.join(dir, "certificado.pdf");
  const conteudo = Buffer.from("%PDF-1.4 certificado e2e " + Date.now() + " " + Math.random());
  fs.writeFileSync(arquivo, conteudo);
  const hash = ethers.keccak256(fs.readFileSync(arquivo));
  ok("arquivo de teste criado e hash calculado: " + hash.slice(0, 18) + "...");

  secao("Antes da emissão");
  let r = await c.verificarCertificado(hash);
  checar(r.existe === false && r.valido === false, "documento ainda não existe na blockchain");
  const totalAntes = await c.totalEmitidos();

  secao("Emissão");
  const curso = "Engenharia de Software - E2E";
  const rec = await (await c.emitirCertificado(hash, curso)).wait();
  ok(`emitirCertificado confirmada (gas ${rec.gasUsed})`);
  const evento = rec.logs
    .map((l) => { try { return c.interface.parseLog(l); } catch { return null; } })
    .find((l) => l && l.name === "CertificadoEmitido");
  checar(evento && evento.args.hashDocumento === hash, "evento CertificadoEmitido com o hash correto");
  r = await c.verificarCertificado(hash);
  checar(r.valido && r.existe && !r.revogado, "verificarCertificado: válido");
  checar(r.emissor.toLowerCase() === signer.address.toLowerCase(), "emissor registrado é a carteira que emitiu");
  checar(r.curso === curso, "curso registrado corretamente");
  checar((await c.totalEmitidos()) === totalAntes + 1n, "totalEmitidos aumentou em 1");
  await reverte(c.emitirCertificado.staticCall(hash, curso), "CertificadoJaExiste", "emitir o mesmo hash de novo");

  secao("Adulteração do arquivo");
  const adulterado = Buffer.from(conteudo);
  adulterado[adulterado.length - 1] ^= 0x01;
  fs.writeFileSync(arquivo, adulterado);
  const hashAdulterado = ethers.keccak256(fs.readFileSync(arquivo));
  checar(hashAdulterado !== hash, "alterar 1 bit do arquivo muda o hash");
  r = await c.verificarCertificado(hashAdulterado);
  checar(!r.existe && !r.valido, "arquivo adulterado NÃO é encontrado na blockchain");
  fs.rmSync(dir, { recursive: true, force: true });

  secao("Permissões (carteira sem autorização)");
  const c2 = c.connect(estranho);
  await reverte(c2.emitirCertificado.staticCall(ethers.id("x" + Date.now()), "Curso"), "NaoAutorizado", "estranho tentando emitir");
  await reverte(c2.revogarCertificado.staticCall(hash, "x"), "NaoAutorizado", "estranho tentando revogar");

  secao("Revogação");
  const recRev = await (await c.revogarCertificado(hash, "Teste ponta a ponta")).wait();
  ok(`revogarCertificado confirmada (gas ${recRev.gasUsed})`);
  r = await c.verificarCertificado(hash);
  checar(r.existe && r.revogado && !r.valido, "após revogar: existe, revogado e não válido (histórico preservado)");
  await reverte(c.revogarCertificado.staticCall(hash, "x"), "CertificadoJaRevogado", "revogar duas vezes");
}

async function fluxoLocalExtra(c, dono, emissor, novoDono, outro) {
  secao("Lote");
  const hashes = ["a", "b", "c"].map((s) => ethers.id("lote-" + s + Date.now()));
  await (await c.emitirLote(hashes, "Turma E2E")).wait();
  let todos = true;
  for (const h of hashes) todos = todos && (await c.verificarCertificado(h)).valido;
  checar(todos, "3 certificados do lote verificam como válidos");
  await reverte(c.emitirLote.staticCall([], "x"), "LoteVazio", "lote vazio");

  secao("Governança");
  await (await c.adicionarEmissor(emissor.address)).wait();
  const h = ethers.id("emissor-novo" + Date.now());
  await (await c.connect(emissor).emitirCertificado(h, "Curso")).wait();
  checar((await c.verificarCertificado(h)).valido, "emissor adicionado consegue emitir");
  await (await c.removerEmissor(emissor.address)).wait();
  await reverte(c.connect(emissor).emitirCertificado.staticCall(ethers.id("y" + Date.now()), "x"), "NaoAutorizado", "emissor removido tentando emitir");
  await reverte(c.connect(outro).adicionarEmissor.staticCall(outro.address), "NaoAutorizado", "não-dono adicionando emissor");
  await (await c.iniciarTransferenciaPropriedade(novoDono.address)).wait();
  checar((await c.dono()) === dono.address, "dono não muda até o novo dono aceitar");
  await (await c.connect(novoDono).aceitarPropriedade()).wait();
  checar((await c.dono()) === novoDono.address, "novo dono assumiu após aceitar");
  await reverte(c.adicionarEmissor.staticCall(outro.address), "NaoAutorizado", "antigo dono perdeu o poder");
}

async function verificarEtherscan(endereco) {
  secao("Código verificado no Etherscan");
  const chave = process.env.ETHERSCAN_API_KEY;
  if (!chave) { console.log("  (ignorado: ETHERSCAN_API_KEY não definida)"); return; }
  try {
    const { chainId } = await ethers.provider.getNetwork();
    const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getsourcecode&address=${endereco}&apikey=${chave}`;
    const j = await (await fetch(url)).json();
    const item = Array.isArray(j.result) ? j.result[0] : null;
    checar(item && item.SourceCode && item.ContractName === "CertificadoVerificavel", "código-fonte publicado e verificado no Etherscan");
  } catch (e) {
    console.log("  (não foi possível consultar o Etherscan: " + e.message + ")");
  }
}

async function main() {
  const remoto = network.name !== "hardhat";
  console.log(`Teste ponta a ponta | rede: ${network.name}`);
  const signers = await ethers.getSigners();
  const signer = signers[0];
  const c = await obterContrato();
  const endereco = await c.getAddress();
  console.log("Contrato:", endereco);

  const estranho = remoto
    ? new ethers.Wallet(ethers.Wallet.createRandom().privateKey, ethers.provider)
    : signers[4];

  await fluxoPrincipal(c, signer, estranho);
  if (!remoto) await fluxoLocalExtra(c, signers[0], signers[1], signers[2], signers[3]);
  if (remoto) await verificarEtherscan(endereco);

  console.log(`\nResultado: ${passou} verificações OK, ${falhou} com erro.`);
  if (falhou > 0) process.exit(1);
  console.log("TUDO CERTO: aplicação validada de ponta a ponta.");
}

main().catch((e) => { console.error("\nFalha inesperada:", e.message); process.exit(1); });
