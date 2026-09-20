#!/usr/bin/env node
/**
 * Backup do banco do PDV.
 *
 * Todo o histórico financeiro da loja — venda, caixa, crediário, auditoria —
 * vive num volume Docker. Volume some: por `docker compose down -v` digitado
 * sem pensar, por disco que falha, por máquina trocada. Sem cópia, some junto
 * o que a loja faturou.
 *
 * O formato é o CUSTOM do pg_dump (`-Fc`), não SQL em texto:
 *   - é comprimido, então cabe em pen drive e sobe rápido para a nuvem;
 *   - `pg_restore` consegue restaurar tabela por tabela a partir dele;
 *   - `pg_restore --list` lê o índice sem restaurar nada, que é como este
 *     script VERIFICA que o arquivo não saiu truncado.
 *
 * Um backup que nunca foi lido não é backup — é um arquivo. Por isso a
 * verificação roda sempre, logo depois de gravar, e o script falha se o
 * arquivo não puder ser lido.
 *
 * Uso:
 *   node scripts/backup.mjs                 # grava em ./backups
 *   node scripts/backup.mjs --destino D:/bk # grava em outro lugar
 *   node scripts/backup.mjs --manter 30     # quantos arquivos preservar
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PREFIXO = 'pdv-';
const SUFIXO = '.dump';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function argumento(nome, padrao) {
  const indice = process.argv.indexOf(`--${nome}`);
  return indice >= 0 && process.argv[indice + 1] ? process.argv[indice + 1] : padrao;
}

/**
 * Destino, em ordem de precedência: `--destino`, `PDV_BACKUP_DESTINO`, `backups`.
 *
 * A variável de ambiente existe para o agendador da máquina ser configurado
 * UMA vez, apontando para fora do disco do banco, em vez de depender de quem
 * agendou ter lembrado de passar a flag.
 */
const destino = resolve(argumento('destino', process.env.PDV_BACKUP_DESTINO ?? 'backups'));
const manter = Number(argumento('manter', '14'));

/**
 * Diz, em voz alta, quando o backup NÃO protege do que a loja imagina.
 *
 * Um backup gravado ao lado do banco cobre exatamente um cenário — alguém
 * apagou dado por engano — e nenhum dos outros: disco que falha, máquina
 * roubada, ransomware. O arquivo existe, a rotina roda verde, e a proteção é
 * menor do que parece. Esse é o tipo de falsa segurança que só aparece no dia
 * em que se precisa dela.
 *
 * Avisa, não falha: recusar o backup por estar no mesmo disco deixaria a loja
 * sem backup nenhum, que é pior.
 */
function avaliarDestino(caminho) {
  const dentroDoProjeto = caminho === RAIZ || caminho.startsWith(RAIZ + sep);
  const mesmoVolume = parse(caminho).root.toLowerCase() === parse(RAIZ).root.toLowerCase();

  if (dentroDoProjeto) {
    return (
      'Este backup está DENTRO do projeto, no mesmo disco do banco.\n' +
      '  Cobre engano humano; não cobre disco que falha, máquina roubada nem ransomware.\n' +
      '  Defina PDV_BACKUP_DESTINO (ou --destino) apontando para fora desta máquina.'
    );
  }
  if (mesmoVolume) {
    return (
      'Este backup está no MESMO volume do projeto.\n' +
      '  Está fora da pasta, mas o disco que falhar leva os dois junto.'
    );
  }
  return null;
}

/**
 * Nome do arquivo com a data em formato ORDENÁVEL (AAAA-MM-DD-HHMM).
 *
 * Ordenável importa: a limpeza dos antigos e a busca do mais recente na
 * restauração são ordenação alfabética de nome de arquivo. Com `DD-MM-AAAA`,
 * a "mais recente" seria a de dia 31 de qualquer mês.
 */
function nomeDoArquivo() {
  const agora = new Date();
  const dois = (valor) => String(valor).padStart(2, '0');
  const carimbo =
    `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}` +
    `-${dois(agora.getHours())}${dois(agora.getMinutes())}`;
  return `${PREFIXO}${carimbo}${SUFIXO}`;
}

/**
 * Executa `pg_dump`/`pg_restore` dentro do contêiner do Postgres.
 *
 * Roda no contêiner de propósito: a versão do cliente precisa ser compatível
 * com a do servidor, e a máquina da loja pode não ter o cliente instalado — ou
 * ter uma versão antiga que recusa o dump ("server version mismatch"). No
 * contêiner, cliente e servidor são a mesma versão por construção.
 */
function noContainer(comando, argumentos, opcoes = {}) {
  return execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'db', comando, ...argumentos],
    { maxBuffer: 1024 * 1024 * 512, ...opcoes },
  );
}

function usuario() {
  return process.env.POSTGRES_USER ?? 'pdv';
}

function banco() {
  return process.env.POSTGRES_DB ?? 'pdv';
}

/** Apaga os backups mais antigos, preservando os `manter` mais recentes. */
function limparAntigos() {
  const arquivos = readdirSync(destino)
    .filter((nome) => nome.startsWith(PREFIXO) && nome.endsWith(SUFIXO))
    .sort()
    .reverse();

  for (const antigo of arquivos.slice(manter)) {
    unlinkSync(join(destino, antigo));
    console.log(`  removido antigo: ${antigo}`);
  }
}

function main() {
  if (!existsSync(destino)) mkdirSync(destino, { recursive: true });

  const arquivo = join(destino, nomeDoArquivo());
  console.log(`Gerando backup de "${banco()}"…`);

  // O dump sai pela saída padrão do contêiner e é gravado aqui: assim não
  // depende de volume compartilhado nem deixa arquivo dentro do contêiner.
  const conteudo = noContainer('pg_dump', ['-U', usuario(), '-d', banco(), '-Fc']);
  writeFileSync(arquivo, conteudo);

  const tamanho = statSync(arquivo).size;
  if (tamanho === 0) {
    throw new Error('O backup saiu vazio. Nada foi preservado — verifique se o banco está de pé.');
  }

  /*
   * VERIFICAÇÃO. `pg_restore --list` lê o índice do arquivo sem restaurar
   * nada: se o dump saiu truncado ou corrompido, isto falha aqui, hoje, e não
   * no dia em que a loja precisar restaurar.
   */
  console.log('Verificando se o arquivo pode ser lido…');
  const indice = execFileSync('docker', ['compose', 'exec', '-T', 'db', 'pg_restore', '--list'], {
    input: conteudo,
    maxBuffer: 1024 * 1024 * 64,
  }).toString();

  const tabelas = indice.split('\n').filter((linha) => linha.includes('TABLE DATA')).length;
  if (tabelas === 0) {
    throw new Error(
      'O backup não contém dado de tabela nenhuma. Não serve para restaurar — investigue antes de confiar nele.',
    );
  }

  console.log(
    `\nBackup concluído: ${arquivo}\n` +
      `  ${(tamanho / 1024).toFixed(0)} KB · ${tabelas} tabelas com dado · arquivo legível`,
  );

  limparAntigos();

  const alerta = avaliarDestino(destino);
  if (alerta) console.warn(`\nATENÇÃO — cópia não está fora da máquina.\n  ${alerta}`);
}

try {
  main();
} catch (erro) {
  console.error(`\nFALHA NO BACKUP: ${erro.message}`);
  if (erro.stderr) console.error(erro.stderr.toString());
  // Sai com código de erro para o agendador da máquina conseguir avisar que
  // falhou. Backup que falha em silêncio é pior que não ter backup: cria a
  // confiança sem o arquivo.
  process.exit(1);
}
