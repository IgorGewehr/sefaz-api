import { describe, it, expect } from 'vitest';
import { getAdnEndpoints } from '../../lib/nfse/nfse-endpoints';

describe('getAdnEndpoints', () => {
  describe('produção', () => {
    const ep = getAdnEndpoints('producao');

    it('endpoint emitir aponta para sefin.nfse.gov.br', () => {
      expect(ep.emitir).toContain('sefin.nfse.gov.br');
      expect(ep.emitir).toContain('/SefinNacional/nfse');
    });

    it('endpoint consultar aponta para adn.nfse.gov.br', () => {
      expect(ep.consultar).toContain('adn.nfse.gov.br');
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
