import { describe, expect, it } from 'vitest';
import { gerarHashSenha, verificarSenha } from './autenticacao.js';

describe('gerarHashSenha() / verificarSenha()', () => {
  it('aceita a senha correta', async () => {
    const hash = await gerarHashSenha('caixa-01');
    expect(await verificarSenha('caixa-01', hash)).toBe(true);
  });

  it('recusa senha errada', async () => {
    const hash = await gerarHashSenha('caixa-01');
    expect(await verificarSenha('caixa-02', hash)).toBe(false);
    expect(await verificarSenha('', hash)).toBe(false);
    expect(await verificarSenha('caixa-01 ', hash)).toBe(false);
  });

  it('gera hashes diferentes para a mesma senha — o sal é aleatório', async () => {
    const primeiro = await gerarHashSenha('mesma-senha');
    const segundo = await gerarHashSenha('mesma-senha');
    expect(primeiro).not.toBe(segundo);
    expect(await verificarSenha('mesma-senha', primeiro)).toBe(true);
    expect(await verificarSenha('mesma-senha', segundo)).toBe(true);
  });

  it('nunca guarda a senha em claro no hash', async () => {
    const hash = await gerarHashSenha('senha-secreta-da-loja');
    expect(hash).not.toContain('senha-secreta-da-loja');
  });

  it('carrega os próprios parâmetros de custo, permitindo aumentá-los depois', async () => {
    const hash = await gerarHashSenha('caixa-01');
    const [algoritmo, custoN, bloco, paralelismo] = hash.split('$');
    expect(algoritmo).toBe('scrypt');
    expect(Number(custoN)).toBe(32768);
    expect(Number(bloco)).toBe(8);
    expect(Number(paralelismo)).toBe(1);
  });

  it('recusa hash malformado em vez de estourar', async () => {
    expect(await verificarSenha('x', 'lixo')).toBe(false);
    expect(await verificarSenha('x', '')).toBe(false);
    expect(await verificarSenha('x', 'md5$1$2$3$4$5')).toBe(false);
  });

  it('exige senha mínima ao cadastrar', async () => {
    await expect(gerarHashSenha('123')).rejects.toThrow(/ao menos 4/);
  });
});
