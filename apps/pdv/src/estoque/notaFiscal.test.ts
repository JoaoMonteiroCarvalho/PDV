import { describe, expect, it } from 'vitest';
import { ErroNota, decimalParaCentavos, lerNotaFiscal, lerQuantidade } from './notaFiscal.js';

/** NF-e mínima, com os campos que a entrada de estoque usa. */
function notaXml(itens: string, opcoes: { semIde?: boolean } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260812345678000199550010000001231000001234" versao="4.00">
      ${opcoes.semIde ? '' : '<ide><nNF>1123</nNF><dhEmi>2026-08-15T14:30:00-03:00</dhEmi></ide>'}
      <emit><CNPJ>12345678000199</CNPJ><xNome>Confeccoes Intimi LTDA</xNome></emit>
      ${itens}
    </infNFe>
  </NFe>
</nfeProc>`;
}

const ITEM_PADRAO = `
  <det nItem="1">
    <prod>
      <cProd>FORN-9931</cProd>
      <cEAN>7890000000017</cEAN>
      <xProd>CONJUNTO RENDA PRETO M</xProd>
      <uCom>UN</uCom>
      <qCom>12.0000</qCom>
      <vUnCom>25.5000000000</vUnCom>
      <vProd>306.00</vProd>
    </prod>
  </det>`;

describe('decimalParaCentavos()', () => {
  it('converte o decimal de 10 casas da NF-e', () => {
    expect(decimalParaCentavos('25.5000000000')).toBe(2_550);
    expect(decimalParaCentavos('0.0100000000')).toBe(1);
    expect(decimalParaCentavos('1234.5600000000')).toBe(123_456);
  });

  it('não passa por float — o caminho que estraga o custo', () => {
    /*
     * `parseFloat('25.55') * 100` dá 2554,999999999999. Com esse caminho, o
     * custo entra um centavo menor e a margem do produto sai errada pelo resto
     * do ano.
     */
    expect(decimalParaCentavos('25.55')).toBe(2_555);
    expect(decimalParaCentavos('8.87')).toBe(887);
    expect(decimalParaCentavos('1.005')).toBe(101);
  });

  it('arredonda a partir da terceira casa, como o emissor imprimiu', () => {
    expect(decimalParaCentavos('25.554')).toBe(2_555);
    expect(decimalParaCentavos('25.555')).toBe(2_556);
    expect(decimalParaCentavos('25.559')).toBe(2_556);
  });

  it('aceita inteiro sem casas decimais', () => {
    expect(decimalParaCentavos('30')).toBe(3_000);
  });

  it('aceita vírgula, que alguns emissores mandam', () => {
    expect(decimalParaCentavos('25,50')).toBe(2_550);
  });

  it('recusa lixo em vez de devolver NaN', () => {
    // NaN entraria no sistema como custo e só apareceria no relatório de margem.
    expect(() => decimalParaCentavos('abc')).toThrow(ErroNota);
    expect(() => decimalParaCentavos('')).toThrow(ErroNota);
  });

  it('devolve sempre inteiro seguro', () => {
    expect(Number.isSafeInteger(decimalParaCentavos('999999.99'))).toBe(true);
  });
});

describe('lerQuantidade()', () => {
  it('lê a quantidade decimal da nota', () => {
    expect(lerQuantidade('12.0000')).toBe(12);
    expect(lerQuantidade('1.5000')).toBe(1.5);
  });

  it('recusa zero e negativo', () => {
    expect(() => lerQuantidade('0')).toThrow(ErroNota);
    expect(() => lerQuantidade('-3')).toThrow(ErroNota);
  });
});

describe('lerNotaFiscal()', () => {
  const nota = lerNotaFiscal(notaXml(ITEM_PADRAO));

  it('identifica número, fornecedor e chave', () => {
    expect(nota.numero).toBe('1123');
    expect(nota.fornecedor).toBe('Confeccoes Intimi LTDA');
    expect(nota.cnpjFornecedor).toBe('12345678000199');
    expect(nota.chave).toBe('35260812345678000199550010000001231000001234');
  });

  it('lê a data de emissão', () => {
    expect(nota.emitidaEm?.getUTCFullYear()).toBe(2026);
  });

  it('traz o item com custo em centavos inteiros', () => {
    const item = nota.itens[0]!;
    expect(item.numeroItem).toBe(1);
    expect(item.codigoFornecedor).toBe('FORN-9931');
    expect(item.codigoBarras).toBe('7890000000017');
    expect(item.descricao).toBe('CONJUNTO RENDA PRETO M');
    expect(item.quantidade).toBe(12);
    expect(item.custoUnitarioCentavos).toBe(2_550);
    expect(item.totalCentavos).toBe(30_600);
  });

  it('usa o total da nota, não a multiplicação', () => {
    /*
     * Com preço de 10 casas, o arredondamento do emissor é o que consta no
     * papel e o que o contador confere. Recalcular criaria divergência de
     * centavos entre o sistema e a nota.
     */
    const comTotalPeculiar = lerNotaFiscal(
      notaXml(`
        <det nItem="1"><prod>
          <cProd>X</cProd><xProd>Y</xProd><uCom>UN</uCom>
          <qCom>3.0000</qCom><vUnCom>3.3333333333</vUnCom><vProd>10.00</vProd>
        </prod></det>`),
    );
    expect(comTotalPeculiar.itens[0]!.totalCentavos).toBe(1_000);
  });

  it('sem <vProd>, calcula a partir do unitário', () => {
    const semTotal = lerNotaFiscal(
      notaXml(`
        <det nItem="1"><prod>
          <cProd>X</cProd><xProd>Y</xProd><uCom>UN</uCom>
          <qCom>2.0000</qCom><vUnCom>10.0000000000</vUnCom>
        </prod></det>`),
    );
    expect(semTotal.itens[0]!.totalCentavos).toBe(2_000);
  });

  it('lê vários itens preservando a ordem da nota', () => {
    const varios = lerNotaFiscal(
      notaXml(`
        ${ITEM_PADRAO}
        <det nItem="2"><prod>
          <cProd>FORN-42</cProd><xProd>CALCINHA NUDE P</xProd><uCom>UN</uCom>
          <qCom>6.0000</qCom><vUnCom>9.9000000000</vUnCom><vProd>59.40</vProd>
        </prod></det>`),
    );
    expect(varios.itens).toHaveLength(2);
    expect(varios.itens.map((i) => i.numeroItem)).toEqual([1, 2]);
    expect(varios.itens[1]!.custoUnitarioCentavos).toBe(990);
  });
});

describe('lerNotaFiscal() — código de barras', () => {
  function comEan(ean: string) {
    return lerNotaFiscal(
      notaXml(`
        <det nItem="1"><prod>
          <cProd>X</cProd><cEAN>${ean}</cEAN><xProd>Y</xProd><uCom>UN</uCom>
          <qCom>1.0000</qCom><vUnCom>1.0000000000</vUnCom>
        </prod></det>`),
    ).itens[0]!.codigoBarras;
  }

  it('"SEM GTIN" vira null, e não um código falso', () => {
    // É o que a NF-e usa quando o produto não tem código de barras. Guardar a
    // string faria a conciliação procurar por um EAN que não existe.
    expect(comEan('SEM GTIN')).toBeNull();
    expect(comEan('SEMGTIN')).toBeNull();
  });

  it('ignora código que não tem cara de EAN', () => {
    expect(comEan('123')).toBeNull();
    expect(comEan('ABC12345')).toBeNull();
  });

  it('aceita EAN-13 e EAN-8', () => {
    expect(comEan('7890000000017')).toBe('7890000000017');
    expect(comEan('78900007')).toBe('78900007');
  });
});

describe('lerNotaFiscal() — erros com instrução', () => {
  it('XML malformado diz que o arquivo é inválido', () => {
    // O DOMParser não lança: devolve um documento com <parsererror> dentro.
    expect(() => lerNotaFiscal('<nfe><nao fecha>')).toThrow(/não é um XML válido/);
  });

  it('XML que não é NF-e diz o que enviar', () => {
    expect(() => lerNotaFiscal('<?xml version="1.0"?><pedido><item/></pedido>')).toThrow(
      /veio com a mercadoria/,
    );
  });

  it('nota sem itens não passa em silêncio', () => {
    expect(() => lerNotaFiscal(notaXml(''))).toThrow('A nota não tem itens.');
  });

  it('item sem quantidade aponta qual linha', () => {
    expect(() =>
      lerNotaFiscal(
        notaXml(`<det nItem="7"><prod><cProd>X</cProd><xProd>Y</xProd><vUnCom>1.00</vUnCom></prod></det>`),
      ),
    ).toThrow(/<qCom> em item 7/);
  });

  it('nota sem <ide> ainda é lida — o que importa são os itens', () => {
    const semIde = lerNotaFiscal(notaXml(ITEM_PADRAO, { semIde: true }));
    expect(semIde.numero).toBe('sem número');
    expect(semIde.itens).toHaveLength(1);
  });
});
