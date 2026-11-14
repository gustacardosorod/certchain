const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const hashDe = (texto) => ethers.keccak256(ethers.toUtf8Bytes(texto));

describe("CertificadoVerificavel", function () {
  async function deployFixture() {
    const [dono, emissor, outro, novoDono] = await ethers.getSigners();
    const Contrato = await ethers.getContractFactory("CertificadoVerificavel");
    const contrato = await Contrato.deploy();
    await contrato.waitForDeployment();
    return { contrato, dono, emissor, outro, novoDono };
  }

  describe("Implantação", function () {
    it("define o dono e o autoriza como emissor", async function () {
      const { contrato, dono } = await loadFixture(deployFixture);
      expect(await contrato.dono()).to.equal(dono.address);
      expect(await contrato.emissores(dono.address)).to.equal(true);
      expect(await contrato.totalEmitidos()).to.equal(0);
    });
  });

  describe("emitirCertificado (função central 1)", function () {
    it("registra o certificado e emite evento", async function () {
      const { contrato, dono } = await loadFixture(deployFixture);
      const h = hashDe("diploma-001.pdf");
      await expect(contrato.emitirCertificado(h, "Engenharia de Software"))
        .to.emit(contrato, "CertificadoEmitido")
        .withArgs(h, dono.address, "Engenharia de Software", anyUint64);
      expect(await contrato.totalEmitidos()).to.equal(1);
    });

    it("rejeita quem não é emissor", async function () {
      const { contrato, outro } = await loadFixture(deployFixture);
      await expect(contrato.connect(outro).emitirCertificado(hashDe("x"), "Curso"))
        .to.be.revertedWithCustomError(contrato, "NaoAutorizado");
    });

    it("rejeita hash zero", async function () {
      const { contrato } = await loadFixture(deployFixture);
      await expect(contrato.emitirCertificado(ethers.ZeroHash, "Curso"))
        .to.be.revertedWithCustomError(contrato, "HashInvalido");
    });

    it("rejeita hash duplicado", async function () {
      const { contrato } = await loadFixture(deployFixture);
      const h = hashDe("dup");
      await contrato.emitirCertificado(h, "Curso");
      await expect(contrato.emitirCertificado(h, "Curso"))
        .to.be.revertedWithCustomError(contrato, "CertificadoJaExiste")
        .withArgs(h);
    });
  });

  describe("verificarCertificado (função central 2)", function () {
    it("retorna válido para certificado emitido", async function () {
      const { contrato, dono } = await loadFixture(deployFixture);
      const h = hashDe("diploma-002.pdf");
      await contrato.emitirCertificado(h, "Sistemas de Informação");
      const r = await contrato.verificarCertificado(h);
      expect(r.valido).to.equal(true);
      expect(r.existe).to.equal(true);
      expect(r.revogado).to.equal(false);
      expect(r.emissor).to.equal(dono.address);
      expect(r.curso).to.equal("Sistemas de Informação");
      expect(r.emitidoEm).to.be.greaterThan(0n);
    });

    it("retorna inexistente para hash desconhecido (documento adulterado)", async function () {
      const { contrato } = await loadFixture(deployFixture);
      const r = await contrato.verificarCertificado(hashDe("adulterado"));
      expect(r.valido).to.equal(false);
      expect(r.existe).to.equal(false);
    });

    it("é uma consulta pública (qualquer endereço pode chamar)", async function () {
      const { contrato, outro } = await loadFixture(deployFixture);
      const h = hashDe("publico");
      await contrato.emitirCertificado(h, "Curso");
      const r = await contrato.connect(outro).verificarCertificado(h);
      expect(r.valido).to.equal(true);
    });
  });

  describe("revogarCertificado", function () {
    it("dono revoga e o certificado deixa de ser válido, mas continua registrado", async function () {
      const { contrato } = await loadFixture(deployFixture);
      const h = hashDe("rev");
      await contrato.emitirCertificado(h, "Curso");
      await expect(contrato.revogarCertificado(h, "Erro de emissão"))
        .to.emit(contrato, "CertificadoRevogado");
      const r = await contrato.verificarCertificado(h);
      expect(r.valido).to.equal(false);
      expect(r.existe).to.equal(true);
      expect(r.revogado).to.equal(true);
    });

    it("emissor original pode revogar o que emitiu", async function () {
      const { contrato, emissor } = await loadFixture(deployFixture);
      await contrato.adicionarEmissor(emissor.address);
      const h = hashDe("rev2");
      await contrato.connect(emissor).emitirCertificado(h, "Curso");
      await expect(contrato.connect(emissor).revogarCertificado(h, "Fraude")).to.not.be.reverted;
    });

    it("terceiros não podem revogar", async function () {
      const { contrato, outro } = await loadFixture(deployFixture);
      const h = hashDe("rev3");
      await contrato.emitirCertificado(h, "Curso");
      await expect(contrato.connect(outro).revogarCertificado(h, "x"))
        .to.be.revertedWithCustomError(contrato, "NaoAutorizado");
    });

    it("não revoga duas vezes nem certificado inexistente", async function () {
      const { contrato } = await loadFixture(deployFixture);
      const h = hashDe("rev4");
      await expect(contrato.revogarCertificado(h, "x"))
        .to.be.revertedWithCustomError(contrato, "CertificadoInexistente");
      await contrato.emitirCertificado(h, "Curso");
      await contrato.revogarCertificado(h, "x");
      await expect(contrato.revogarCertificado(h, "x"))
        .to.be.revertedWithCustomError(contrato, "CertificadoJaRevogado");
    });
  });

  describe("emitirLote", function () {
    it("registra vários certificados de uma vez", async function () {
      const { contrato } = await loadFixture(deployFixture);
      const hashes = ["a", "b", "c"].map(hashDe);
      await contrato.emitirLote(hashes, "Turma 2026");
      expect(await contrato.totalEmitidos()).to.equal(3);
      for (const h of hashes) {
        expect((await contrato.verificarCertificado(h)).valido).to.equal(true);
      }
    });

    it("rejeita lote vazio e lote com duplicado (reverte tudo)", async function () {
      const { contrato } = await loadFixture(deployFixture);
      await expect(contrato.emitirLote([], "Curso")).to.be.revertedWithCustomError(contrato, "LoteVazio");
      const h = hashDe("d");
      await expect(contrato.emitirLote([h, h], "Curso"))
        .to.be.revertedWithCustomError(contrato, "CertificadoJaExiste");
      expect(await contrato.totalEmitidos()).to.equal(0);
    });
  });

  describe("Governança", function () {
    it("dono adiciona e remove emissores", async function () {
      const { contrato, emissor } = await loadFixture(deployFixture);
      await expect(contrato.adicionarEmissor(emissor.address))
        .to.emit(contrato, "EmissorAdicionado").withArgs(emissor.address);
      await contrato.connect(emissor).emitirCertificado(hashDe("g1"), "Curso");
      await expect(contrato.removerEmissor(emissor.address))
        .to.emit(contrato, "EmissorRemovido").withArgs(emissor.address);
      await expect(contrato.connect(emissor).emitirCertificado(hashDe("g2"), "Curso"))
        .to.be.revertedWithCustomError(contrato, "NaoAutorizado");
    });

    it("somente o dono gerencia emissores; endereço zero é inválido", async function () {
      const { contrato, outro } = await loadFixture(deployFixture);
      await expect(contrato.connect(outro).adicionarEmissor(outro.address))
        .to.be.revertedWithCustomError(contrato, "NaoAutorizado");
      await expect(contrato.adicionarEmissor(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(contrato, "EnderecoInvalido");
    });

    it("transferência de propriedade em duas etapas", async function () {
      const { contrato, dono, novoDono, outro } = await loadFixture(deployFixture);
      await contrato.iniciarTransferenciaPropriedade(novoDono.address);
      expect(await contrato.dono()).to.equal(dono.address); // ainda não mudou
      await expect(contrato.connect(outro).aceitarPropriedade())
        .to.be.revertedWithCustomError(contrato, "NaoAutorizado");
      await expect(contrato.connect(novoDono).aceitarPropriedade())
        .to.emit(contrato, "PropriedadeTransferida").withArgs(dono.address, novoDono.address);
      expect(await contrato.dono()).to.equal(novoDono.address);
      await expect(contrato.adicionarEmissor(outro.address))
        .to.be.revertedWithCustomError(contrato, "NaoAutorizado"); // antigo dono perdeu o poder
    });
  });
});

// Matcher auxiliar: aceita qualquer valor (timestamp do bloco)
function anyUint64() { return true; }
