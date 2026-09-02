/**
 * Configurações — três blocos com donos diferentes, e a tela deixa isso claro.
 *
 *   1. ESTA MÁQUINA (tema, 3D). Fica no `localStorage` e vale só neste
 *      computador. O caixa da frente pode querer 3D e o do fundo não; forçar
 *      igual para os dois seria pior.
 *   2. A LOJA (nome, endereço, CNPJ, linha extra da política). Vai ao
 *      servidor porque sai impressa no comprovante de todo caixa.
 *   3. AS PESSOAS (usuários). Só gerente vê e mexe.
 *
 * Operadora entra aqui e vê o bloco 1 inteiro, o 2 em leitura e nada do 3.
 * Esconder o bloco 2 dela seria pior: ela precisa conferir o que está saindo
 * impresso quando a cliente reclama do endereço no papel.
 */

import { useEffect, useState } from 'react';
import { Botao, Campo, Cartao, Erro, Selo, cx } from '../componentes/base.js';
import {
  clienteApi,
  type ConfiguracaoLoja,
  type PapelUsuario,
  type UsuarioAdmin,
} from '../api/cliente.js';
import { ehGerente, useSessao } from '../estado/sessaoStore.js';
import { guardarLoja } from '../impressao/loja.js';
import { aplicarTema, temaSalvo, type Tema } from '../design/tema.js';
import { definirEfeitos3d, efeitos3dLigados, webglDisponivel } from '../tres/capacidade.js';
import {
  DESCRICAO_DO_PAPEL,
  bpsParaCampo,
  bpsParaTexto,
  normalizarLogin,
  validarLimiteDesconto,
  validarNovoUsuario,
  type ErrosDeUsuario,
} from '../configuracoes/regras.js';

export function TelaConfiguracoes() {
  const operadora = useSessao((estado) => estado.operadora);
  const gerente = ehGerente(operadora);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header>
        <h1 className="font-titulo text-[26px] font-semibold tracking-tight">Configurações</h1>
        <p className="mt-1 text-[14px] text-ink-soft">
          {gerente
            ? 'Preferências deste computador, dados da loja e quem usa o sistema.'
            : 'Preferências deste computador. Os dados da loja só o gerente altera.'}
        </p>
      </header>

      <BlocoDestaMaquina />
      <BlocoDaLoja podeEditar={gerente} />
      {gerente && <BlocoDeUsuarios meuId={operadora?.id ?? ''} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Esta máquina
// ---------------------------------------------------------------------------

function BlocoDestaMaquina() {
  const [tema, setTema] = useState<Tema>(() => temaSalvo());
  const [tres, setTres] = useState(() => efeitos3dLigados());
  const temWebgl = webglDisponivel();

  function trocarTema(novo: Tema) {
    setTema(novo);
    aplicarTema(novo);
  }

  /*
   * Mudar o 3D exige recarregar: as cenas decidem o que montar UMA vez, no
   * primeiro render, e trocar isso no meio deixaria telas já abertas em
   * estados diferentes. Recarregar é honesto e leva um segundo.
   */
  function trocar3d(ligado: boolean) {
    setTres(ligado);
    definirEfeitos3d(ligado);
    window.location.reload();
  }

  return (
    <Secao titulo="Este computador" descricao="Vale só aqui. Não afeta os outros caixas.">
      <Linha
        titulo="Tema escuro"
        detalhe="O sistema abre claro por padrão, independente do tema do Windows."
      >
        <Interruptor
          ligado={tema === 'dark'}
          rotulo="Tema escuro"
          aoTrocar={(ligado) => trocarTema(ligado ? 'dark' : 'light')}
        />
      </Linha>

      <Linha
        titulo="Efeitos 3D"
        detalhe={
          temWebgl
            ? 'Mostra o modelo da peça no catálogo, na consulta e na confirmação da venda. Desligado, entram as versões simples — o sistema funciona igual.'
            : 'Este computador não tem aceleração gráfica disponível, então as versões simples já estão em uso.'
        }
      >
        <Interruptor
          ligado={tres && temWebgl}
          rotulo="Efeitos 3D"
          desabilitado={!temWebgl}
          aoTrocar={trocar3d}
        />
      </Linha>
    </Secao>
  );
}

// ---------------------------------------------------------------------------
// 2. A loja
// ---------------------------------------------------------------------------

const LOJA_VAZIA = {
  nome: '',
  endereco: '',
  telefone: '',
  cnpj: '',
  politicaTrocaExtra: '',
};

function BlocoDaLoja({ podeEditar }: { podeEditar: boolean }) {
  const [campos, setCampos] = useState(LOJA_VAZIA);
  const [carregando, setCarregando] = useState(true);
  const [falha, setFalha] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const configuracao = await clienteApi.obterConfiguracaoLoja();
        if (!vivo) return;
        preencher(configuracao);
        guardarLoja(configuracao);
        setFalha(null);
      } catch (erro) {
        if (vivo) setFalha(erro instanceof Error ? erro.message : 'Não foi possível carregar.');
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  function preencher(configuracao: ConfiguracaoLoja) {
    setCampos({
      nome: configuracao.nome,
      endereco: configuracao.endereco ?? '',
      telefone: configuracao.telefone ?? '',
      cnpj: configuracao.cnpj ?? '',
      politicaTrocaExtra: configuracao.politicaTrocaExtra ?? '',
    });
  }

  function alterar(campo: keyof typeof LOJA_VAZIA, valor: string) {
    setCampos((atual) => ({ ...atual, [campo]: valor }));
    setSalvo(false);
  }

  async function salvar() {
    if (campos.nome.trim().length === 0) {
      setFalha('O nome da loja não pode ficar em branco — ele é o cabeçalho do comprovante.');
      return;
    }
    setSalvando(true);
    setFalha(null);
    try {
      const configuracao = await clienteApi.salvarConfiguracaoLoja({
        nome: campos.nome.trim(),
        endereco: campos.endereco.trim(),
        telefone: campos.telefone.trim(),
        cnpj: campos.cnpj.trim(),
        politicaTrocaExtra: campos.politicaTrocaExtra.trim(),
      });
      preencher(configuracao);
      // O comprovante passa a sair com os dados novos já na próxima venda,
      // sem esperar recarregar a página.
      guardarLoja(configuracao);
      setSalvo(true);
    } catch (erro) {
      setFalha(erro instanceof Error ? erro.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) {
    return (
      <Secao titulo="Dados da loja" descricao="Saem impressos no comprovante.">
        <p className="text-[14px] text-ink-soft">Carregando…</p>
      </Secao>
    );
  }

  return (
    <Secao
      titulo="Dados da loja"
      descricao="Saem impressos no cabeçalho de todo comprovante."
      acessorio={!podeEditar ? <Selo tom="neutro">Somente leitura</Selo> : undefined}
    >
      {falha && <Erro>{falha}</Erro>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          rotulo="Nome"
          value={campos.nome}
          disabled={!podeEditar}
          onChange={(evento) => alterar('nome', evento.target.value)}
        />
        <Campo
          rotulo="Telefone"
          value={campos.telefone}
          disabled={!podeEditar}
          onChange={(evento) => alterar('telefone', evento.target.value)}
        />
        <Campo
          rotulo="Endereço"
          value={campos.endereco}
          disabled={!podeEditar}
          onChange={(evento) => alterar('endereco', evento.target.value)}
        />
        <Campo
          rotulo="CNPJ"
          value={campos.cnpj}
          disabled={!podeEditar}
          onChange={(evento) => alterar('cnpj', evento.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Campo
          rotulo="Linha extra na política de troca (opcional)"
          placeholder="Ex.: Trocas de segunda a sexta, das 9h às 17h."
          value={campos.politicaTrocaExtra}
          disabled={!podeEditar}
          maxLength={200}
          onChange={(evento) => alterar('politicaTrocaExtra', evento.target.value)}
        />
        {/*
         * Aviso deliberado. Já apareceu a ideia de usar este campo para
         * escrever "não trocamos peça íntima em nenhuma hipótese" — o que
         * seria promessa ilegal. O texto legal é fixo e este campo só soma.
         */}
        <p className="text-[13px] text-ink-faint">
          Esta linha é <strong>somada</strong> ao texto legal, que continua sendo impresso: troca
          por defeito de fabricação é garantida por lei e não pode ser removida daqui.
        </p>
      </div>

      {podeEditar && (
        <div className="flex items-center gap-3">
          <Botao onClick={() => void salvar()} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar dados da loja'}
          </Botao>
          {salvo && <span className="text-[13px] text-ok">Salvo.</span>}
        </div>
      )}
    </Secao>
  );
}

// ---------------------------------------------------------------------------
// 3. As pessoas
// ---------------------------------------------------------------------------

const PAPEIS: PapelUsuario[] = ['OPERADOR', 'GERENTE', 'ADMIN'];

function BlocoDeUsuarios({ meuId }: { meuId: string }) {
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [falha, setFalha] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  async function recarregar() {
    try {
      setUsuarios(await clienteApi.listarUsuarios());
      setFalha(null);
    } catch (erro) {
      setFalha(erro instanceof Error ? erro.message : 'Não foi possível listar os usuários.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void recarregar();
  }, []);

  async function alternarAtivo(usuario: UsuarioAdmin) {
    try {
      await clienteApi.atualizarUsuario(usuario.id, { ativo: !usuario.ativo });
      setFalha(null);
      await recarregar();
    } catch (erro) {
      // A recusa do servidor ("último gerente", "não pode se desativar") é
      // informação útil: aparece como está, sem virar "erro inesperado".
      setFalha(erro instanceof Error ? erro.message : 'Não foi possível alterar o usuário.');
    }
  }

  return (
    <Secao
      titulo="Usuários"
      descricao="Quem entra no sistema. Usuário não é apagado, só desativado — ele assina vendas e sangrias já registradas."
      acessorio={
        <Botao variante="neutro" onClick={() => setCriando((atual) => !atual)}>
          {criando ? 'Cancelar' : 'Novo usuário'}
        </Botao>
      }
    >
      {falha && <Erro>{falha}</Erro>}

      {criando && (
        <FormularioNovoUsuario
          aoCriar={async () => {
            setCriando(false);
            await recarregar();
          }}
        />
      )}

      {carregando ? (
        <p className="text-[14px] text-ink-soft">Carregando…</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {usuarios.map((usuario) => (
            <ItemDeUsuario
              key={usuario.id}
              usuario={usuario}
              souEu={usuario.id === meuId}
              aoAlternarAtivo={() => void alternarAtivo(usuario)}
              aoMudar={() => void recarregar()}
              aoFalhar={setFalha}
            />
          ))}
        </ul>
      )}
    </Secao>
  );
}

function ItemDeUsuario({
  usuario,
  souEu,
  aoAlternarAtivo,
  aoMudar,
  aoFalhar,
}: {
  usuario: UsuarioAdmin;
  souEu: boolean;
  aoAlternarAtivo: () => void;
  aoMudar: () => void;
  aoFalhar: (mensagem: string) => void;
}) {
  const [editando, setEditando] = useState(false);

  return (
    <li className="flex flex-col gap-3 py-3" data-testid={`usuario-${usuario.login}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">
            {usuario.nome}
            {souEu && <span className="ml-2 text-[13px] text-ink-faint">(você)</span>}
          </p>
          <p className="text-[13px] text-ink-soft" data-testid={`resumo-${usuario.login}`}>
            {usuario.login} · {rotuloDoPapel(usuario.papel)} · desconto{' '}
            {bpsParaTexto(usuario.limiteDescontoBps)}
          </p>
        </div>

        <Selo tom={usuario.ativo ? 'ok' : 'neutro'}>{usuario.ativo ? 'Ativo' : 'Inativo'}</Selo>

        <Botao variante="discreto" onClick={() => setEditando((atual) => !atual)}>
          {editando ? 'Fechar' : 'Editar'}
        </Botao>

        <Botao
          variante="discreto"
          onClick={aoAlternarAtivo}
          // Desativar a si mesmo trancaria a pessoa para fora agora mesmo. O
          // servidor também recusa; aqui o botão nem chega a convidar.
          disabled={souEu}
          title={souEu ? 'Você não pode desativar a si mesmo.' : undefined}
        >
          {usuario.ativo ? 'Desativar' : 'Reativar'}
        </Botao>
      </div>

      {editando && (
        <EdicaoDeUsuario
          usuario={usuario}
          souEu={souEu}
          aoSalvar={() => {
            setEditando(false);
            aoMudar();
          }}
          aoFalhar={aoFalhar}
        />
      )}
    </li>
  );
}

function EdicaoDeUsuario({
  usuario,
  souEu,
  aoSalvar,
  aoFalhar,
}: {
  usuario: UsuarioAdmin;
  souEu: boolean;
  aoSalvar: () => void;
  aoFalhar: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState(usuario.nome);
  const [papel, setPapel] = useState<PapelUsuario>(usuario.papel);
  const [limite, setLimite] = useState(bpsParaCampo(usuario.limiteDescontoBps));
  const [senha, setSenha] = useState('');
  const [erros, setErros] = useState<ErrosDeUsuario>({});
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const limiteValidado = validarLimiteDesconto(limite);
    const novosErros: ErrosDeUsuario = {};
    if (nome.trim().length < 2) novosErros.nome = 'Informe o nome.';
    if (limiteValidado.erro) novosErros.limite = limiteValidado.erro;
    if (senha.length > 0 && senha.length < 6) {
      novosErros.senha = 'A senha precisa de pelo menos 6 caracteres.';
    }
    setErros(novosErros);
    if (Object.keys(novosErros).length > 0) return;

    setSalvando(true);
    try {
      await clienteApi.atualizarUsuario(usuario.id, {
        nome: nome.trim(),
        papel,
        limiteDescontoBps: limiteValidado.bps,
      });
      // A senha vai numa chamada separada de propósito: assim, se ela falhar,
      // o nome e o papel já salvos não são perdidos, e a mensagem diz o que
      // de fato não passou.
      if (senha.length > 0) await clienteApi.trocarSenhaDe(usuario.id, senha);
      aoSalvar();
    } catch (erro) {
      aoFalhar(erro instanceof Error ? erro.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-[14px] bg-sunken p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          rotulo="Nome"
          value={nome}
          erro={erros.nome}
          onChange={(evento) => setNome(evento.target.value)}
        />
        <Campo
          rotulo="Limite de desconto (%)"
          numerico
          inputMode="decimal"
          placeholder="0"
          value={limite}
          erro={erros.limite}
          onChange={(evento) => setLimite(evento.target.value)}
        />
      </div>

      <SeletorDePapel
        valor={papel}
        aoTrocar={setPapel}
        // Mudar o próprio papel é o caminho curto para virar admin sozinho.
        desabilitado={souEu}
        nota={souEu ? 'Você não pode mudar o próprio papel. Peça a outro gerente.' : undefined}
      />

      <Campo
        rotulo="Nova senha (deixe em branco para manter)"
        type="password"
        autoComplete="new-password"
        value={senha}
        erro={erros.senha}
        onChange={(evento) => setSenha(evento.target.value)}
      />

      <div>
        <Botao onClick={() => void salvar()} disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar alterações'}
        </Botao>
      </div>
    </div>
  );
}

const NOVO_VAZIO = { nome: '', login: '', senha: '', limite: '' };

function FormularioNovoUsuario({ aoCriar }: { aoCriar: () => Promise<void> }) {
  const [campos, setCampos] = useState(NOVO_VAZIO);
  const [papel, setPapel] = useState<PapelUsuario>('OPERADOR');
  const [erros, setErros] = useState<ErrosDeUsuario>({});
  const [falha, setFalha] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  function alterar(campo: keyof typeof NOVO_VAZIO, valor: string) {
    setCampos((atual) => ({ ...atual, [campo]: valor }));
  }

  async function criar() {
    const novosErros = validarNovoUsuario(campos);
    setErros(novosErros);
    if (Object.keys(novosErros).length > 0) return;

    setSalvando(true);
    setFalha(null);
    try {
      await clienteApi.criarUsuario({
        nome: campos.nome.trim(),
        login: normalizarLogin(campos.login),
        senha: campos.senha,
        papel,
        limiteDescontoBps: validarLimiteDesconto(campos.limite).bps,
      });
      setCampos(NOVO_VAZIO);
      await aoCriar();
    } catch (erro) {
      setFalha(erro instanceof Error ? erro.message : 'Não foi possível criar o usuário.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div
      className="flex flex-col gap-4 rounded-[14px] border border-line bg-sunken p-4"
      data-testid="form-novo-usuario"
    >
      <h3 className="text-[15px] font-medium">Novo usuário</h3>
      {falha && <Erro>{falha}</Erro>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          rotulo="Nome"
          value={campos.nome}
          erro={erros.nome}
          onChange={(evento) => alterar('nome', evento.target.value)}
        />
        <Campo
          rotulo="Login"
          autoCapitalize="none"
          autoComplete="off"
          value={campos.login}
          erro={erros.login}
          onChange={(evento) => alterar('login', evento.target.value)}
        />
        <Campo
          rotulo="Senha"
          type="password"
          autoComplete="new-password"
          value={campos.senha}
          erro={erros.senha}
          onChange={(evento) => alterar('senha', evento.target.value)}
        />
        <Campo
          rotulo="Limite de desconto (%)"
          numerico
          inputMode="decimal"
          placeholder="0"
          value={campos.limite}
          erro={erros.limite}
          onChange={(evento) => alterar('limite', evento.target.value)}
        />
      </div>

      <SeletorDePapel valor={papel} aoTrocar={setPapel} />

      <div>
        <Botao onClick={() => void criar()} disabled={salvando}>
          {salvando ? 'Criando…' : 'Criar usuário'}
        </Botao>
      </div>
    </div>
  );
}

/**
 * Papel como três botões com a explicação à vista, não uma lista suspensa.
 *
 * "GERENTE" não diz a ninguém o que a pessoa passa a poder. Quem cadastra
 * precisa ler "também autoriza sangria e devolução" ANTES de clicar, não
 * descobrir depois que deu acesso ao cofre.
 */
function SeletorDePapel({
  valor,
  aoTrocar,
  desabilitado = false,
  nota,
}: {
  valor: PapelUsuario;
  aoTrocar: (papel: PapelUsuario) => void;
  desabilitado?: boolean;
  nota?: string | undefined;
}) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={desabilitado}>
      <legend className="mb-1 text-[13px] text-ink-soft">Papel</legend>
      <div className="flex flex-col gap-2">
        {PAPEIS.map((papel) => (
          <label
            key={papel}
            className={cx(
              'flex cursor-pointer items-start gap-3 rounded-[12px] border p-3 transition-colors duration-200',
              valor === papel ? 'border-accent bg-accent-soft' : 'border-line bg-surface',
              desabilitado && 'cursor-default opacity-60',
            )}
          >
            <input
              type="radio"
              name={`papel-${valor}`}
              className="mt-1"
              checked={valor === papel}
              onChange={() => aoTrocar(papel)}
            />
            <span>
              <span className="block text-[14px] font-medium">{rotuloDoPapel(papel)}</span>
              <span className="block text-[13px] text-ink-soft">{DESCRICAO_DO_PAPEL[papel]}</span>
            </span>
          </label>
        ))}
      </div>
      {nota && <p className="text-[13px] text-ink-faint">{nota}</p>}
    </fieldset>
  );
}

function rotuloDoPapel(papel: PapelUsuario): string {
  return papel === 'OPERADOR' ? 'Operador' : papel === 'GERENTE' ? 'Gerente' : 'Administrador';
}

// ---------------------------------------------------------------------------
// Peças da própria tela
// ---------------------------------------------------------------------------

function Secao({
  titulo,
  descricao,
  acessorio,
  children,
}: {
  titulo: string;
  descricao: string;
  acessorio?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Cartao className="flex flex-col gap-5 p-5">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-titulo text-[18px] font-semibold tracking-tight">{titulo}</h2>
          <p className="mt-0.5 text-[14px] text-ink-soft">{descricao}</p>
        </div>
        {acessorio}
      </div>
      {children}
    </Cartao>
  );
}

function Linha({
  titulo,
  detalhe,
  children,
}: {
  titulo: string;
  detalhe: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 border-t border-line pt-4 first:border-0 first:pt-0">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium">{titulo}</p>
        <p className="mt-0.5 text-[13px] text-ink-soft">{detalhe}</p>
      </div>
      {children}
    </div>
  );
}

/** Interruptor de verdade — `role="switch"`, para o leitor de tela anunciar. */
function Interruptor({
  ligado,
  rotulo,
  desabilitado = false,
  aoTrocar,
}: {
  ligado: boolean;
  rotulo: string;
  desabilitado?: boolean;
  aoTrocar: (ligado: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      disabled={desabilitado}
      onClick={() => aoTrocar(!ligado)}
      className={cx(
        'relative h-8 w-[52px] shrink-0 rounded-full transition-colors duration-200',
        ligado ? 'bg-accent' : 'bg-line',
        desabilitado && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cx(
          'absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-[left] duration-200',
          ligado ? 'left-[24px]' : 'left-1',
        )}
      />
    </button>
  );
}
