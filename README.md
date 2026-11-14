# CertChain UniSales — Proposta e Relatório Técnico

**Disciplina:** Implantação de Tecnologia Blockchain — Engenharia de Software (EaD)
**Aluno:** Gustavo Cardoso — Centro Universitário Salesiano — Vitória/ES
**Entrega:** 14/11/2026

---

## Parte A — Proposta e concepção

### A.1 Caso de uso

**Tema:** certificados e diplomas verificáveis (tema sugerido no enunciado).

**Problema.** Certificados e declarações acadêmicas em PDF são fáceis de falsificar e a verificação costuma exigir contato manual com a instituição (e-mail, telefone, secretaria), o que é lento, custoso e depende da disponibilidade de quem emitiu. Empresas e outras instituições têm dificuldade de confiar em um documento recebido.

**Público.** Instituições de ensino (emissoras), egressos e alunos (titulares), empregadores e demais instituições (verificadores).

**Justificativa para blockchain.**
- Registro **imutável e com data** da emissão, sem depender de um único servidor.
- Verificação **pública, gratuita e 24/7**, sem intermediário.
- Trilha de auditoria de emissões e revogações.
- Múltiplos atores que não precisam confiar uns nos outros (instituição, aluno, empregador) compartilham a mesma fonte de verdade.

**Solução.** A instituição calcula o hash (keccak256) do PDF do certificado e o registra no contrato. Para verificar, qualquer pessoa recalcula o hash do arquivo recebido e consulta o contrato. Se o arquivo for alterado em um único byte, o hash muda e a verificação falha. **Nenhum dado pessoal é gravado on-chain.**

**Fora de escopo.** Este DApp não substitui o diploma digital oficial (que segue as regras do MEC e exige assinatura com certificado ICP-Brasil); ele funciona como camada complementar de verificação de autenticidade.

### A.2 Comparação de plataformas

| Critério | Ethereum (testnet Sepolia) | BNB Smart Chain (testnet BSC) |
|---|---|---|
| Consenso | Proof of Stake, grande conjunto de validadores | Proof of Staked Authority, conjunto reduzido de validadores |
| Descentralização | Maior | Menor (mais centralizada) |
| Custo de transação | Em geral mais alto na mainnet | Em geral mais baixo |
| Ecossistema e ferramentas | Mais amplo (Hardhat, Remix, Etherscan, OpenZeppelin) | Compatível com EVM; usa as mesmas ferramentas |
| Linguagem | Solidity (EVM) | Solidity (EVM) |
| Explorer | Etherscan | BscScan |
| Adequação ao caso de uso | Alta: o valor do registro é a **confiança**, e ela cresce com a descentralização | Média: atrativa pelo custo, mas depende de poucos validadores |

**Decisão: Ethereum, com implantação na Sepolia.** Como o objetivo do sistema é provar autenticidade para terceiros desconhecidos, a neutralidade e a descentralização pesam mais que o custo por transação. O custo é mitigado por design: o contrato guarda só o hash e oferece emissão em lote. Como ambas são compatíveis com a EVM, o mesmo contrato poderia ser migrado para uma L2 ou outra rede compatível sem reescrita, caso o volume de emissões justifique.

### A.3 Modelo de dados do contrato

```
Certificado (mapping hashDocumento => Certificado)
 ├─ emissor     : address   // endereço que emitiu
 ├─ emitidoEm   : uint64    // timestamp da emissão
 ├─ revogadoEm  : uint64    // 0 = ativo; >0 = revogado
 └─ curso       : string    // nome do curso/evento (dado não pessoal)

Estado global
 ├─ dono          : address                    // Registro Acadêmico
 ├─ donoPendente  : address                    // transferência em duas etapas
 ├─ emissores     : mapping(address => bool)   // quem pode emitir
 └─ totalEmitidos : uint256
```

**Eventos:** `CertificadoEmitido`, `CertificadoRevogado`, `EmissorAdicionado`, `EmissorRemovido`, `PropriedadeTransferenciaIniciada`, `PropriedadeTransferida`.

**Decisões de modelagem:**
- A chave é o **hash do documento**; não existe nome, CPF ou matrícula on-chain.
- Revogação **não apaga** o registro: marca `revogadoEm`, preservando o histórico para auditoria.
- Erros personalizados (`error`) em vez de strings de revert, para reduzir gas.

---

## Parte B — Smart contract

- **Arquivo:** `contracts/CertificadoVerificavel.sol` (Solidity 0.8.24, otimizador com 200 runs).
- **Funções centrais implementadas e testadas:** `emitirCertificado` e `verificarCertificado`; além delas, `revogarCertificado`, `emitirLote` e funções de governança.
- **Testes:** 17 casos automatizados (Hardhat + Chai), todos passando, cobrindo emissão, duplicidade, hash inválido, permissões, verificação de documento inexistente, revogação, lote atômico (reverte tudo se houver duplicado) e transferência de propriedade.

Execução: `npx hardhat test`.

---

## Parte C — Implantação e relatório técnico

### C.1 Dados da implantação

| Item | Valor |
|---|---|
| Rede | Sepolia (testnet pública) |
| Endereço do contrato | `0x740845c3A154B3B7603fbe9710A1233aD4F12656` |
| Link no Etherscan | https://sepolia.etherscan.io/address/0x740845c3A154B3B7603fbe9710A1233aD4F12656#code |
| Código verificado | Sim (`npx hardhat verify`, aba Contract com selo verde) |
| Tx de deploy | `0xc723eba330fb854a3b5d2bb7ec8c005e7243750df27c72a916506df6621e3909` |
| Gas do deploy | 5.352.938 |
| Preço do gas no deploy | 1,0 gwei |
| Custo do deploy (ETH de teste) | 0,005352938 ETH |


### C.2 Decisões de arquitetura

1. **Hash on-chain, documento off-chain.** Armazenar o PDF seria inviável em custo e incompatível com a LGPD. O hash prova a integridade sem expor conteúdo.
2. **Contrato não atualizável (sem proxy).** Regras imutáveis dão previsibilidade e confiança a verificadores externos; correções são feitas por revogação e nova emissão.
3. **Controle de acesso simples e explícito.** Papéis de dono e emissores, sem dependências externas, o que reduz a superfície de ataque e facilita a auditoria acadêmica.
4. **Transferência de propriedade em duas etapas**, evitando perder o controle por um endereço digitado errado.
5. **Emissão em lote** para o cenário de formatura de uma turma inteira.
6. **Verificação como função `view`**, gratuita para quem consulta.
7. **Hardhat** como ambiente: testes automatizados, scripts reproduzíveis de deploy e verificação.

### C.3 Custos de gas

Medição em rede local Hardhat (`npm run gas`), otimizador ligado. **O deploy na Sepolia foi medido separadamente (ver C.1 e a análise abaixo).**

| Operação | Gas |
|---|---:|
| Deploy do contrato | 788.308 |
| adicionarEmissor | 47.333 |
| emitirCertificado (1 certificado) | 119.595 |
| emitirLote (10 certificados, total) | 763.103 |
| emitirLote (por certificado) | 76.310 |
| revogarCertificado | 52.121 |
| removerEmissor | 25.371 |
| iniciarTransferenciaPropriedade | 47.738 |
| aceitarPropriedade | 28.272 |
| verificarCertificado | 0 (view) |

**Análise.** A emissão em lote reduz o gas por certificado em cerca de 36% (de 119.595 para 76.310) na rede local, porque a parte fixa da transação (21.000 de gas) é paga uma só vez. Custo em ETH = gas × preço do gas; no deploy da Sepolia, 5.352.938 × 1,0 gwei = 0,005352938 ETH de teste.

**Diferença entre rede local e Sepolia.** O deploy consumiu 788.308 de gas na rede local, mas 5.352.938 na Sepolia (cerca de 6,8 vezes mais), com o mesmo código-fonte (bytecode de 3.183 bytes). A explicação mais provável é a atualização Glamsterdam, já ativada na Sepolia: a EIP-8037 reajusta para cima o custo de criar estado novo na rede, o que inclui a implantação de contratos. A rede local do Hardhat ainda aplica os preços anteriores. O cronograma de ativação na mainnet deve ser conferido; enquanto a atualização não estiver ativa lá, o custo de deploy tende a ficar mais próximo do medido localmente. Consequência para o projeto: operações que gravam novos dados (emissão de certificados) também podem custar mais na Sepolia do que na tabela acima, e os valores de emissão e revogação da demo devem ser lidos nas transações do Etherscan (C.1).

### C.4 Modelo de governança

**Tipo: híbrido.**

| Aspecto | On-chain | Off-chain |
|---|---|---|
| Quem pode emitir | Mapping `emissores`, gerido pelo `dono` | Conselho Acadêmico decide quem é emissor (ata) |
| Quem pode revogar | Dono ou emissor original | Política de revogação: fraude, erro de emissão, decisão judicial |
| Poder de alteração do contrato | **Nenhum** (sem proxy, sem função de upgrade) | Nova versão exige novo deploy e comunicação pública |
| Troca do dono | Duas etapas (`iniciar` + `aceitar`) | Aprovação da reitoria |
| Verificação | Pública, sem permissão | Divulgação do endereço oficial no site da instituição |

**Quem detém o poder:** o `dono` (Registro Acadêmico) controla somente a lista de emissores e a revogação; ele **não** pode apagar, editar ou falsificar registros já emitidos. Cada emissão fica vinculada ao endereço do emissor e à data.

**Evolução recomendada para produção:** o dono deve ser uma carteira **multisig** (por exemplo, 3 de 5 membros do Registro Acadêmico e da TI), eliminando o ponto único de falha de uma chave privada. A transferência em duas etapas já viabiliza essa migração sem novo deploy.

**Riscos e mitigação:**
- *Perda ou roubo da chave do dono* → multisig e rotação de dono.
- *Emissor malicioso* → remoção imediata via `removerEmissor` e revogação dos certificados emitidos.
- *Documento legítimo emitido por engano* → revogação e nova emissão (histórico preservado).

### Aspectos legais e regulatórios (base para a fala)

- **LGPD (Lei 13.709/2018).** Dados na blockchain são praticamente impossíveis de apagar, o que conflita com o direito de eliminação. Mitigação por design: gravar apenas o hash, sem nome, CPF ou matrícula, de modo que o registro on-chain não identifica diretamente o titular. A relação entre hash e pessoa existe apenas no documento guardado off-chain pela instituição e pelo titular.
- **Diploma digital e assinatura eletrônica.** A emissão oficial de diplomas no Brasil segue regras do MEC (Portaria MEC 554/2019) e usa certificados ICP-Brasil (MP 2.200-2/2001). A Lei 14.063/2020 trata dos tipos de assinatura eletrônica. O registro em blockchain **não substitui** esses requisitos; funciona como prova complementar de integridade e data.
- **Valor probatório.** O hash comprova que o documento existia naquele momento e não foi alterado, mas não comprova por si só a identidade de quem o emitiu fora do contexto institucional; por isso o endereço oficial do contrato deve ser divulgado pela instituição.
- **Marco legal dos criptoativos (Lei 14.478/2022).** O sistema não cria nem negocia token ou ativo virtual; usa a rede apenas para registro, o que afasta o enquadramento como prestação de serviços de ativos virtuais. O ETH é usado somente para pagar taxas de transação.
- **Responsabilidade.** A instituição permanece responsável pelo conteúdo emitido e pela gestão das chaves; é necessária política interna de custódia e revogação.

---

## Limitações e trabalhos futuros

- Interface web (front-end) para verificação por arrastar-e-soltar do PDF.
- Dono como multisig (Safe) e emissores por unidade acadêmica.
- Possível migração para uma L2 compatível com EVM em caso de grande volume.
- Integração com o fluxo oficial de diploma digital (ICP-Brasil).
