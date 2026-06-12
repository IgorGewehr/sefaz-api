import { describe, it, expect } from 'vitest';
import { getAdnEndpoints } from '../../lib/nfse/nfse-endpoints';

describe('getAdnEndpoints', () => {
  describe('produção', () => {
    const ep = getAdnEndpoints('producao');

    it('endpoint emitir aponta para sefin.nfse.gov.br', () => {
      expect(ep.emitir).toContain('sefin.nfse.gov.br');
      expect(ep.emitir).toContain('/SefinNacional/nfse');
    });

    it('endpoint consultar aponta para sefin.nfse.gov.br (GET /nfse/{chave})', () => {
      expect(ep.consultar).toContain('sefin.nfse.gov.br');
      expect(ep.consultar).toContain('/SefinNacional/nfse');
    });

    it('endpoint consultarDps aponta para sefin.nfse.gov.br (GET /dps/{idDps})', () => {
      expect(ep.consultarDps).toContain('sefin.nfse.gov.br');
      expect(ep.consultarDps).toContain('/SefinNacional/dps');
    });

    it('endpoint eventos aponta para a base /SefinNacional/nfse (POST /{chave}/eventos)', () => {
      expect(ep.eventos).toBe('https://sefin.nfse.gov.br/SefinNacional/nfse');
    });

    it('todos endpoints usam HTTPS', () => {
      expect(ep.emitir).toMatch(/^https:\/\//);
      expect(ep.consultar).toMatch(/^https:\/\//);
      expect(ep.cancelar).toMatch(/^https:\/\//);
      expect(ep.substituir).toMatch(/^https:\/\//);
    });
  });

  describe('homologação', () => {
    const ep = getAdnEndpoints('homologacao');

    it('endpoint emitir aponta para producaorestrita', () => {
      expect(ep.emitir).toContain('producaorestrita.nfse.gov.br');
    });

    it('endpoint consultar aponta para producaorestrita', () => {
      expect(ep.consultar).toContain('producaorestrita.nfse.gov.br');
    });

    it('todos endpoints usam HTTPS', () => {
      expect(ep.emitir).toMatch(/^https:\/\//);
      expect(ep.consultar).toMatch(/^https:\/\//);
    });
  });
});
