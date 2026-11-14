// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title CertificadoVerificavel
 * @notice Registro on-chain de certificados/diplomas verificáveis da UniSales (organização fictícia).
 * @dev Armazena apenas o HASH (keccak256/SHA-256) do documento emitido, nunca dados pessoais do aluno
 *      (adequação à LGPD). O PDF original fica off-chain; qualquer pessoa pode recalcular o hash do
 *      arquivo e conferir sua autenticidade com `verificarCertificado`.
 *
 * Governança (modelo híbrido):
 *  - ON-CHAIN: papéis de `dono` (Registro Acadêmico) e `emissores` (secretarias/coordenações).
 *  - OFF-CHAIN: a decisão de quem é emissor é tomada pelo Conselho Acadêmico; o dono apenas executa.
 *  - Contrato NÃO é atualizável (sem proxy): regras imutáveis geram confiança. Correções são feitas
 *    por revogação + nova emissão, preservando o histórico.
 */
contract CertificadoVerificavel {
    // ---------------------------------------------------------------------
    // Tipos e estado
    // ---------------------------------------------------------------------
    struct Certificado {
        address emissor;     // quem emitiu
        uint64 emitidoEm;    // timestamp da emissão
        uint64 revogadoEm;   // 0 = não revogado
        string curso;        // nome do curso/evento (dado não pessoal)
    }

    address public dono;
    address public donoPendente; // transferência de propriedade em duas etapas

    uint256 public totalEmitidos;

    mapping(address => bool) public emissores;
    mapping(bytes32 => Certificado) private _certificados; // hash do documento => dados
    mapping(bytes32 => bool) private _existe;

    // ---------------------------------------------------------------------
    // Eventos e erros
    // ---------------------------------------------------------------------
    event CertificadoEmitido(bytes32 indexed hashDocumento, address indexed emissor, string curso, uint64 emitidoEm);
    event CertificadoRevogado(bytes32 indexed hashDocumento, address indexed por, string motivo, uint64 revogadoEm);
    event EmissorAdicionado(address indexed emissor);
    event EmissorRemovido(address indexed emissor);
    event PropriedadeTransferenciaIniciada(address indexed de, address indexed para);
    event PropriedadeTransferida(address indexed de, address indexed para);

    error NaoAutorizado();
    error EnderecoInvalido();
    error HashInvalido();
    error CertificadoJaExiste(bytes32 hashDocumento);
    error CertificadoInexistente(bytes32 hashDocumento);
    error CertificadoJaRevogado(bytes32 hashDocumento);
    error LoteVazio();

    // ---------------------------------------------------------------------
    // Modificadores
    // ---------------------------------------------------------------------
    modifier somenteDono() {
        if (msg.sender != dono) revert NaoAutorizado();
        _;
    }

    modifier somenteEmissor() {
        if (!emissores[msg.sender]) revert NaoAutorizado();
        _;
    }

    constructor() {
        dono = msg.sender;
        emissores[msg.sender] = true;
        emit EmissorAdicionado(msg.sender);
    }

    // ---------------------------------------------------------------------
    // Funções centrais
    // ---------------------------------------------------------------------

    /// @notice Registra um certificado a partir do hash do documento.
    function emitirCertificado(bytes32 hashDocumento, string calldata curso) external somenteEmissor {
        _registrar(hashDocumento, curso);
    }

    /// @notice Registra vários certificados do mesmo curso em uma única transação (economiza gas).
    function emitirLote(bytes32[] calldata hashes, string calldata curso) external somenteEmissor {
        uint256 n = hashes.length;
        if (n == 0) revert LoteVazio();
        for (uint256 i = 0; i < n; ++i) {
            _registrar(hashes[i], curso);
        }
    }

    /// @notice Consulta pública (gratuita) da autenticidade de um documento.
    /// @return valido true se existe e não foi revogado
    function verificarCertificado(bytes32 hashDocumento)
        external
        view
        returns (bool valido, bool existe, bool revogado, address emissor, uint64 emitidoEm, string memory curso)
    {
        existe = _existe[hashDocumento];
        if (!existe) {
            return (false, false, false, address(0), 0, "");
        }
        Certificado storage c = _certificados[hashDocumento];
        revogado = c.revogadoEm != 0;
        return (!revogado, true, revogado, c.emissor, c.emitidoEm, c.curso);
    }

    /// @notice Revoga um certificado (fraude, erro de emissão). O registro permanece para auditoria.
    /// @dev Só o dono ou o emissor original podem revogar.
    function revogarCertificado(bytes32 hashDocumento, string calldata motivo) external {
        if (!_existe[hashDocumento]) revert CertificadoInexistente(hashDocumento);
        Certificado storage c = _certificados[hashDocumento];
        if (msg.sender != dono && msg.sender != c.emissor) revert NaoAutorizado();
        if (c.revogadoEm != 0) revert CertificadoJaRevogado(hashDocumento);

        c.revogadoEm = uint64(block.timestamp);
        emit CertificadoRevogado(hashDocumento, msg.sender, motivo, c.revogadoEm);
    }

    // ---------------------------------------------------------------------
    // Governança
    // ---------------------------------------------------------------------

    function adicionarEmissor(address novo) external somenteDono {
        if (novo == address(0)) revert EnderecoInvalido();
        emissores[novo] = true;
        emit EmissorAdicionado(novo);
    }

    function removerEmissor(address emissor) external somenteDono {
        emissores[emissor] = false;
        emit EmissorRemovido(emissor);
    }

    /// @notice Etapa 1: o dono atual indica o novo dono (ex.: um multisig).
    function iniciarTransferenciaPropriedade(address novoDono) external somenteDono {
        if (novoDono == address(0)) revert EnderecoInvalido();
        donoPendente = novoDono;
        emit PropriedadeTransferenciaIniciada(dono, novoDono);
    }

    /// @notice Etapa 2: o novo dono aceita, evitando perder o controle por endereço digitado errado.
    function aceitarPropriedade() external {
        if (msg.sender != donoPendente) revert NaoAutorizado();
        address antigo = dono;
        dono = msg.sender;
        donoPendente = address(0);
        emit PropriedadeTransferida(antigo, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Internas
    // ---------------------------------------------------------------------
    function _registrar(bytes32 hashDocumento, string calldata curso) internal {
        if (hashDocumento == bytes32(0)) revert HashInvalido();
        if (_existe[hashDocumento]) revert CertificadoJaExiste(hashDocumento);

        _existe[hashDocumento] = true;
        uint64 agora = uint64(block.timestamp);
        _certificados[hashDocumento] = Certificado({
            emissor: msg.sender,
            emitidoEm: agora,
            revogadoEm: 0,
            curso: curso
        });
        unchecked { ++totalEmitidos; }

        emit CertificadoEmitido(hashDocumento, msg.sender, curso, agora);
    }
}
