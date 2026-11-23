# XSD da NF-e/NFC-e 4.00 (PL_009_V4)

`nfe_v4.00.xsd`, `leiauteNFe_v4.00.xsd`, `tiposBasico_v4.00.xsd` e `xmldsig-core-schema_v1.01.xsd`
do pacote de liberação PL_009_V4, copiados de `nfephp-org/sped-nfe` (`schemes/PL_009_V4`, que espelha
o pacote publicado no Portal da NF-e). Usados por `unit/nfe-xsd-oficial.test.ts` para validar, com o
xmllint, o XML que o `sefaz-api` monta — a NF-e, a NFC-e normal e a NFC-e em contingência off-line.

A assinatura é RSA-SHA1 (o leiaute exige). Em sistemas com política que bloqueia SHA-1 (Fedora/RHEL:
`invalid digest` no xml-crypto), rode com `OPENSSL_ENABLE_SHA1_SIGNATURES=1`.
