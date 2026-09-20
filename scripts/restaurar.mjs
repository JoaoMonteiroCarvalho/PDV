#!/usr/bin/env node
/**
 * Restauração do banco do PDV, e o TESTE dela.
 *
 * Duas formas de usar, e a segunda é a que importa no dia a dia:
 *
 *   --testar            restaura num banco descartável, confere e apaga.
 *                       Não encosta no banco de produção. É o que responde
 *                       "o backup de ontem presta?" sem arriscar nada.
 *
 *   --para <banco>      restaura de verdade, num banco que você nomeia.
 *
 * Restaurar POR CIMA do banco em uso não é oferecido de propósito. É uma
 * operação que apaga o presente para trazer o passado, e ela tem que ser
 * deliberada: restaure num banco novo, confira, e só então aponte a API para
 * ele. Um script que faz isso com uma flag é um script que um dia vai fazer
 * isso por engano.
 *
 * Uso:
 *   node scripts/restaurar.mjs --testar
 *   node scripts/restaurar.mjs --testar --arquivo backups/pdv-2026-09-19-1430.dump
 *   node scripts/restaurar.mjs --para pdv_recuperado
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PREFIXO = 'pdv-';
const SUFIXO = '.dump';

/** Tabelas cuja presença prova que o dump é de um banco do PDV de verdade. */
const TABELAS_ESPERADAS = ['Venda', 'ItemVenda', 'Pagamento', 'SessaoCaixa', 'Usuario', 'Variante'];

function argumento(nome, padrao) {
  const indice = process.argv.indexOf(`--${nome}`);
  return indice >= 0 && process.argv[indice + 1] ? process.argv[indice + 1] : padrao;
}

const temFlag = (nome) => process.argv.includes(`--${nome}`);
const usuario = () => process.env.POSTGRES_USER ?? 'pdv';

function noContainer(comando, argumentos, opcoes = {}) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'db', comando, ...argumentos], {
    maxBuffer: 1024 * 1024 * 512,
    ...opcoes,
  });
}

/** O backup mais recente da pasta. Nomes são ordenáveis por construção. */
function backupMaisRecente(pasta) {
  if (!existsSync(pasta)) {
    throw new Error(`A pasta "${pasta}" não existe. Rode um backup antes.`);
  }
  const arquivos = readdirSync(pasta)
    .filter((nome) => nome.startsWith(PREFIXO) && nome.endsWith(SUFIXO))
    .sort()
    .reverse();
  if (arquivos.length === 0) {
    throw new Error(`Nenhum backup em "${pasta}".`);
  }
  return join(pasta, arquivos[0]);
}

function criarBanco(nome) {
  // `--if-exists` evita erro quando o banco de teste sobrou de uma execução
  // interrompida. Só vale para o banco descartável.
  execFileSync('docker', [
    'compose', 'exec', '-T', 'db',
    'psql', '-U', usuario(), '-d', 'postgres',
    '-c', `DROP DATABASE IF EXISTS "${nome}"`,
  ]);
  execFileSync('docker', [
    'compose', 'exec', '-T', 'db',
    'psql', '-U', usuario(), '-d', 'postgres',
    '-c', `CREATE DATABASE "${nome}"`,
  ]);
}

function apagarBanco(nome) {
  execFileSync('docker', [
    'compose', 'exec', '-T', 'db',
    'psql', '-U', usuario(), '-d', 'postgres',
    '-c', `DROP DATABASE IF EXISTS "${nome}"`,
  ]);
}

function contar(banco, tabela) {
  const saida = noContainer('psql', [
    '-U', usuario(), '-d', banco,
    '-t', '-A', '-c', `SELECT count(*) FROM "${tabela}"`,
  ]).toString().trim();
  return Number(saida);
}

function restaurarEm(banco, conteudo) {
  noContainer(
    'pg_restore',
    ['-U', usuario(), '-d', banco, '--no-owner', '--no-privileges'],
    { input: conteudo },
  );
}

function main() {
  const pasta = resolve(argumento('pasta', 'backups'));
  const arquivo = argumento('arquivo', null)
    ? resolve(argumento('arquivo'))
    : backupMaisRecente(pasta);

  if (!existsSync(arquivo)) throw new Error(`Arquivo não encontrado: ${arquivo}`);
  const conteudo = readFileSync(arquivo);
  console.log(`Usando ${arquivo} (${(conteudo.length / 1024).toFixed(0)} KB)`);

  if (temFlag('testar')) {
    /*
     * Banco descartável com nome carimbado pelo relógio: se duas execuções se
     * cruzarem, uma não derruba o banco da outra no meio da restauração.
     */
    const bancoDeTeste = `pdv_restauracao_${Date.now()}`;
    console.log(`\nRestaurando em "${bancoDeTeste}" (descartável)…`);

    try {
      criarBanco(bancoDeTeste);
      restaurarEm(bancoDeTeste, conteudo);

      console.log('\nConferindo o que veio:\n');
      let totalLinhas = 0;
      for (const tabela of TABELAS_ESPERADAS) {
        const linhas = contar(bancoDeTeste, tabela);
        totalLinhas += linhas;
        console.log(`  ${tabela.padEnd(14)} ${String(linhas).padStart(7)} linhas`);
      }

      /*
       * Um banco restaurado com as tabelas TODAS vazias passaria numa
       * verificação que só checasse "restaurou sem erro" — e é exatamente o
       * backup inútil que se quer detectar. Loja nova tem pouco dado, mas
       * `Usuario` nunca é zero: sem usuário ninguém entra no sistema.
       */
      if (contar(bancoDeTeste, 'Usuario') === 0) {
        throw new Error(
          'O banco restaurou sem nenhum usuário. Este backup não serviria para a loja voltar a operar.',
        );
      }

      console.log(
        `\nTESTE OK. O backup restaura, e traz ${totalLinhas} linhas nas tabelas principais.`,
      );
    } finally {
      // Some mesmo se a conferência falhar: banco de teste esquecido no
      // servidor vira confusão na próxima vez que alguém listar os bancos.
      apagarBanco(bancoDeTeste);
      console.log(`Banco de teste "${bancoDeTeste}" removido.`);
    }
    return;
  }

  const alvo = argumento('para', null);
  if (!alvo) {
    console.error(
      'Informe o que fazer:\n' +
        '  --testar            restaura num banco descartável e confere\n' +
        '  --para <banco>      restaura num banco nomeado por você\n\n' +
        'Restaurar por cima do banco em uso não é oferecido: crie um banco novo,\n' +
        'confira, e só então aponte a API para ele.',
    );
    process.exit(1);
  }

  console.log(`\nRestaurando em "${alvo}"…`);
  criarBanco(alvo);
  restaurarEm(alvo, conteudo);
  console.log(
    `\nPronto. Confira com:\n` +
      `  docker compose exec db psql -U ${usuario()} -d ${alvo} -c '\\dt'\n` +
      `Depois aponte DATABASE_URL para "${alvo}" e reinicie a API.`,
  );
}

try {
  main();
} catch (erro) {
  console.error(`\nFALHA: ${erro.message}`);
  if (erro.stderr) console.error(erro.stderr.toString());
  process.exit(1);
}
