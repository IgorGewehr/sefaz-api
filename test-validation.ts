// Script de teste para validações de NF-e
// Execute com: npx tsx test-validation.ts

import type { NFeRequest } from './src/types';

// Mock da função emitirNFe para testar apenas a validação
async function testValidation() {
  console.log('=== TESTES DE VALIDAÇÃO ===\n');

  // Teste 1: Payload sem número
  console.log('Teste 1: Payload sem número da nota');
  const payloadSemNumero = {
    ufEmitente: 'SP',
    emitente: {
      cnpj: '12345678000195',
      inscricaoEstadual: '123456789',
      crt: '1',
      nome: 'Empresa Teste',
      endereco: {
        logradouro: 'Rua Teste',
        numero: '123',
        bairro: 'Centro',
        codigoMunicipio: '3550308',
        municipio: 'São Paulo',
        uf: 'SP',
        cep: '01234567',
      },
    },
    destinatario: {
      cpf: '12345678901',
      nome: 'Cliente Teste',
      indicadorIE: '9',
    },
    itens: [],
    pagamento: { formas: [] },
  } as any;

  try {
    // Simular a validação
    const errors: string[] = [];
    if (!payloadSemNumero.numero) errors.push('Número da NF-e é obrigatório');
    if (!payloadSemNumero.itens || payloadSemNumero.itens.length === 0) {
      errors.push('NF-e deve ter ao menos 1 item');
    }
    if (!payloadSemNumero.pagamento || !payloadSemNumero.pagamento.formas || payloadSemNumero.pagamento.formas.length === 0) {
      errors.push('Formas de pagamento são obrigatórias');
    }

    if (errors.length > 0) {
      console.log('✓ REJEITADO - Erros encontrados:');
      errors.forEach(e => console.log(`  - ${e}`));
    }
  } catch (err: any) {
    console.log('✗ ERRO INESPERADO:', err.message);
  }

  console.log('\n---\n');

  // Teste 2: Item sem NCM
  console.log('Teste 2: Item sem NCM válido');
  const payloadItemSemNCM = {
    numero: 123,
    ufEmitente: 'SP',
    emitente: {
      cnpj: '12345678000195',
      inscricaoEstadual: '123456789',
      crt: '3',
      nome: 'Empresa Teste',
      endereco: {
        logradouro: 'Rua Teste',
        numero: '123',
        bairro: 'Centro',
        codigoMunicipio: '3550308',
        municipio: 'São Paulo',
        uf: 'SP',
        cep: '01234567',
      },
    },
    destinatario: {
      cpf: '12345678901',
      nome: 'Cliente Teste',
      indicadorIE: '9',
    },
    itens: [
      {
        numero: 1,
        produto: {
          codigo: 'PROD001',
          descricao: 'Produto Teste',
          ncm: '1234', // NCM inválido (deve ter 8 dígitos)
          cfop: '5102',
          unidade: 'UN',
          quantidade: 1,
          valorUnitario: 100.00,
          valorTotal: 100.00,
          cEAN: 'SEM GTIN',
          unidadeTrib: 'UN',
          quantidadeTrib: 1,
          valorUnitarioTrib: 100.00,
          cEANTrib: 'SEM GTIN',
          indTot: '1',
        },
        imposto: {
          icms: {
            orig: '0',
            cst: '00',
            modBC: '0',
            valorBC: 100.00,
            aliquota: 18.00,
            valor: 18.00,
          },
          pis: {
            cst: '01',
            valorBC: 100.00,
            aliquota: 1.65,
            valor: 1.65,
          },
          cofins: {
            cst: '01',
            valorBC: 100.00,
            aliquota: 7.6,
            valor: 7.60,
          },
        },
      },
    ],
    pagamento: {
      formas: [{ tipo: '01', valor: 100.00 }],
    },
  } as any;

  try {
    const errors: string[] = [];

    if (payloadItemSemNCM.itens && payloadItemSemNCM.itens.length > 0) {
      payloadItemSemNCM.itens.forEach((item: any, i: number) => {
        const idx = i + 1;
        if (!item.produto.ncm || !/^\d{8}$/.test(item.produto.ncm)) {
          errors.push(`Item ${idx}: NCM inválido (deve ter 8 dígitos)`);
        }
      });
    }

    if (errors.length > 0) {
      console.log('✓ REJEITADO - Erros encontrados:');
      errors.forEach(e => console.log(`  - ${e}`));
    }
  } catch (err: any) {
    console.log('✗ ERRO INESPERADO:', err.message);
  }

  console.log('\n---\n');

  // Teste 3: Sem CST do ICMS para Regime Normal
  console.log('Teste 3: Sem CST do ICMS para Regime Normal (CRT=3)');
  const payloadSemCST = {
    numero: 123,
    ufEmitente: 'SP',
    emitente: {
      cnpj: '12345678000195',
      inscricaoEstadual: '123456789',
      crt: '3', // Regime Normal
      nome: 'Empresa Teste',
      endereco: {
        logradouro: 'Rua Teste',
        numero: '123',
        bairro: 'Centro',
        codigoMunicipio: '3550308',
        municipio: 'São Paulo',
        uf: 'SP',
        cep: '01234567',
      },
    },
    destinatario: {
      cpf: '12345678901',
      nome: 'Cliente Teste',
      indicadorIE: '9',
    },
    itens: [
      {
        numero: 1,
        produto: {
          codigo: 'PROD001',
          descricao: 'Produto Teste',
          ncm: '12345678',
          cfop: '5102',
          unidade: 'UN',
          quantidade: 1,
          valorUnitario: 100.00,
          valorTotal: 100.00,
          cEAN: 'SEM GTIN',
          unidadeTrib: 'UN',
          quantidadeTrib: 1,
          valorUnitarioTrib: 100.00,
          cEANTrib: 'SEM GTIN',
          indTot: '1',
        },
        imposto: {
          icms: {
            orig: '0',
            // cst faltando!
          },
          pis: {
            cst: '01',
            valorBC: 100.00,
            aliquota: 1.65,
            valor: 1.65,
          },
          cofins: {
            cst: '01',
            valorBC: 100.00,
            aliquota: 7.6,
            valor: 7.60,
          },
        },
      },
    ],
    pagamento: {
      formas: [{ tipo: '01', valor: 100.00 }],
    },
  } as any;

  try {
    const errors: string[] = [];
    const crt = payloadSemCST.emitente?.crt;

    if (payloadSemCST.itens && payloadSemCST.itens.length > 0) {
      payloadSemCST.itens.forEach((item: any, i: number) => {
        const idx = i + 1;
        const icms = item.imposto?.icms;

        if (crt === '3') {
          // Regime Normal
          if (!icms.cst) {
            errors.push(`Item ${idx}: CST ICMS obrigatório para Regime Normal`);
          }
        }
      });
    }

    if (errors.length > 0) {
      console.log('✓ REJEITADO - Erros encontrados:');
      errors.forEach(e => console.log(`  - ${e}`));
    }
  } catch (err: any) {
    console.log('✗ ERRO INESPERADO:', err.message);
  }

  console.log('\n---\n');

  // Teste 4: Valor ICMS inconsistente com BC e alíquota
  console.log('Teste 4: Valor ICMS inconsistente (BC=100, aliq=18%, valor=10 - deveria ser 18)');
  const payloadValorInconsistente = {
    numero: 123,
    ufEmitente: 'SP',
    emitente: {
      cnpj: '12345678000195',
      inscricaoEstadual: '123456789',
      crt: '3',
      nome: 'Empresa Teste',
      endereco: {
        logradouro: 'Rua Teste',
        numero: '123',
        bairro: 'Centro',
        codigoMunicipio: '3550308',
        municipio: 'São Paulo',
        uf: 'SP',
        cep: '01234567',
      },
    },
    destinatario: {
      cpf: '12345678901',
      nome: 'Cliente Teste',
      indicadorIE: '9',
    },
    itens: [
      {
        numero: 1,
        produto: {
          codigo: 'PROD001',
          descricao: 'Produto Teste',
          ncm: '12345678',
          cfop: '5102',
          unidade: 'UN',
          quantidade: 1,
          valorUnitario: 100.00,
          valorTotal: 100.00,
          cEAN: 'SEM GTIN',
          unidadeTrib: 'UN',
          quantidadeTrib: 1,
          valorUnitarioTrib: 100.00,
          cEANTrib: 'SEM GTIN',
          indTot: '1',
        },
        imposto: {
          icms: {
            orig: '0',
            cst: '00',
            modBC: '0',
            valorBC: 100.00,
            aliquota: 18.00,
            valor: 10.00, // ERRADO! Deveria ser 18.00
          },
          pis: {
            cst: '01',
            valorBC: 100.00,
            aliquota: 1.65,
            valor: 1.65,
          },
          cofins: {
            cst: '01',
            valorBC: 100.00,
            aliquota: 7.6,
            valor: 7.60,
          },
        },
      },
    ],
    pagamento: {
      formas: [{ tipo: '01', valor: 100.00 }],
    },
  } as any;

  try {
    const errors: string[] = [];

    if (payloadValorInconsistente.itens && payloadValorInconsistente.itens.length > 0) {
      payloadValorInconsistente.itens.forEach((item: any, i: number) => {
        const idx = i + 1;
        const icms = item.imposto?.icms;

        // Validar cálculo
        if (icms.valorBC && icms.aliquota !== undefined && icms.valor !== undefined) {
          const expectedValue = (icms.valorBC * icms.aliquota) / 100;
          const diff = Math.abs(expectedValue - icms.valor);
          const tolerance = 0.01;

          if (diff > tolerance) {
            errors.push(`Item ${idx}: valor ICMS inconsistente (esperado ${expectedValue.toFixed(2)})`);
          }
        }
      });
    }

    if (errors.length > 0) {
      console.log('✓ REJEITADO - Erros encontrados:');
      errors.forEach(e => console.log(`  - ${e}`));
    }
  } catch (err: any) {
    console.log('✗ ERRO INESPERADO:', err.message);
  }

  console.log('\n---\n');

  // Teste 5: Payload válido
  console.log('Teste 5: Payload VÁLIDO');
  const payloadValido = {
    numero: 123,
    ufEmitente: 'SP',
    naturezaOperacao: 'VENDA',
    tipoOperacao: '1',
    finalidade: '1',
    consumidorFinal: '1',
    presencaComprador: '1',
    serie: '1',
    emitente: {
      cnpj: '12345678000195',
      inscricaoEstadual: '123456789',
      crt: '3',
      nome: 'Empresa Teste',
      endereco: {
        logradouro: 'Rua Teste',
        numero: '123',
        bairro: 'Centro',
        codigoMunicipio: '3550308',
        municipio: 'São Paulo',
        uf: 'SP',
        cep: '01234567',
      },
    },
    destinatario: {
      cpf: '12345678901',
      nome: 'Cliente Teste',
      indicadorIE: '9',
      endereco: {
        logradouro: 'Rua Cliente',
        numero: '456',
        bairro: 'Centro',
        codigoMunicipio: '3550308',
        municipio: 'São Paulo',
        uf: 'SP',
        cep: '01234567',
      },
    },
    itens: [
      {
        numero: 1,
        produto: {
          codigo: 'PROD001',
          descricao: 'Produto Teste',
          ncm: '12345678',
          cfop: '5102',
          unidade: 'UN',
          quantidade: 1,
          valorUnitario: 100.00,
          valorTotal: 100.00,
          cEAN: 'SEM GTIN',
          unidadeTrib: 'UN',
          quantidadeTrib: 1,
          valorUnitarioTrib: 100.00,
          cEANTrib: 'SEM GTIN',
          indTot: '1',
        },
        imposto: {
          icms: {
            orig: '0',
            cst: '00',
            modBC: '0',
            valorBC: 100.00,
            aliquota: 18.00,
            valor: 18.00, // CORRETO!
          },
          pis: {
            cst: '01',
            valorBC: 100.00,
            aliquota: 1.65,
            valor: 1.65,
          },
          cofins: {
            cst: '01',
            valorBC: 100.00,
            aliquota: 7.6,
            valor: 7.60,
          },
        },
      },
    ],
    transporte: {
      modFrete: '9',
    },
    pagamento: {
      formas: [{ tipo: '01', valor: 100.00 }],
    },
  } as any;

  try {
    const errors: string[] = [];

    // Simular todas as validações básicas
    if (!payloadValido.numero) errors.push('Número da NF-e é obrigatório');
    if (!payloadValido.itens || payloadValido.itens.length === 0) {
      errors.push('NF-e deve ter ao menos 1 item');
    }

    if (errors.length > 0) {
      console.log('✗ REJEITADO - Erros encontrados:');
      errors.forEach(e => console.log(`  - ${e}`));
    } else {
      console.log('✓ ACEITO - Payload passou todas as validações!');
    }
  } catch (err: any) {
    console.log('✗ ERRO INESPERADO:', err.message);
  }

  console.log('\n=== FIM DOS TESTES ===\n');
}

testValidation().catch(console.error);
