/**
 * Instância única do motor de sincronização.
 *
 * Antes vivia dentro do componente da tela de venda, o que amarrava a
 * sincronização a uma rota: sair da venda parava de enviar a fila. Com
 * roteamento, o motor precisa viver acima das rotas — a fila continua subindo
 * enquanto a operadora consulta um produto ou confere o caixa.
 */

import { clienteApi } from '../api/cliente.js';
import { bancoLocal } from '../banco/local.js';
import { MotorSincronizacao } from './motor.js';

export const motorSincronizacao = new MotorSincronizacao(bancoLocal, clienteApi);
