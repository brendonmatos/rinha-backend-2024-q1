// @ts-ignore
import {Pool } from 'pg'


const pool = new Pool({
  host: "localhost",
  port: 5432,
  user: "admin",
  password: "123",
  database: "rinha",
});

const UPDATE_CUSTOMER_QUERY = `UPDATE clientes SET saldo = $1, transacoes = $2 WHERE id = $3;`;
const SELECT_CUSTOMER_BY_ID = (id: number) => `SELECT * FROM clientes WHERE id = ${id}`;


const IS_CLIENTES_TRANSACOES = /clientes\/(\d+)\/transacoes$/;
const IS_CLIENTES_EXTRATO = /clientes\/(\d+)\/extrato$/;


const handleTransaction = async (req: Request) => {
  const matches = req.url.match(IS_CLIENTES_TRANSACOES);

  if (!matches) {
    return { status: 404 };
  }

  const customerId = parseInt(matches[1]);

  if (!customerId || customerId <= 0 || customerId > 5) {
    return { status: 404 };
  }

  const { valor, tipo, descricao } = await req.json() as {
    valor: number;
    tipo: string;
    descricao: string;
  };

  if (
    !valor ||
    typeof valor !== "number" ||
    valor <= 0 ||
    Math.floor(valor) !== valor
  ) {
    return { status: 422 };
  }

  if (!["c", "d"].includes(tipo)) {
    return { status: 422 };
  }

  if (
    !descricao ||
    typeof descricao !== "string" ||
    descricao.length <= 0 ||
    descricao.length > 10
  ) {
    return { status: 422 };
  }

  const poolClient = await pool.connect();
  await poolClient.query("BEGIN");

  const result = await poolClient.query(
    SELECT_CUSTOMER_BY_ID(customerId) + " FOR UPDATE"
  );

  const [customer] = result.rows;

  const transactions = JSON.parse(customer.transacoes);

  if (tipo === "d" && customer.saldo - valor < -customer.limite) {
    await poolClient.query("ROLLBACK");
    poolClient.release();

    return { status: 422 };
  }

  const newBalance =
    tipo === "c" ? customer.saldo + valor : customer.saldo - valor;

  if (transactions.length === 10) {
    transactions.pop();
  }

  transactions.unshift({
    descricao: descricao,
    tipo: tipo,
    valor: valor,
    realizada_em: new Date(),
  });

  await poolClient.query(UPDATE_CUSTOMER_QUERY, [
    newBalance,
    JSON.stringify(transactions),
    customerId,
  ]);

  await poolClient.query("COMMIT");

  poolClient.release();

  return {
    status: 200,
    body: {
      limite: customer.limite,
      saldo: newBalance,
    },
  };

}

const handleExtrato = async (req: Request) => {
  const matches = req.url.match(IS_CLIENTES_EXTRATO);

  if (!matches) {
    return { status: 404 };
  }

  const customerId = parseInt(matches[1]);

  if (!customerId || customerId <= 0 || customerId > 5) {
    return { status: 404 };
  }

  const { rows } = await pool.query(SELECT_CUSTOMER_BY_ID(customerId));



  return {
    status: 200,
    body: {
      saldo: {
        total: rows[0].saldo,
        data_extrato: new Date(),
        limite: rows[0].limite,
      },
      ultimas_transacoes: JSON.parse(rows[0].transacoes),
    },
  };
}

const handleHealth = async (req: Request) => {
  return { status: 200 };
}

Bun.serve({
  port: process.env.API_PORT,
  websocket: undefined as any,
  async fetch(req) {
    // console.log(`METHOD: ${req.method} - URL: ${req.url}`);

    if (req.method === "POST" && IS_CLIENTES_TRANSACOES.test(req.url)) {
      const result = await handleTransaction(req);
      const response = new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: {
          "Content-Type": "application/json",
        },
      })
      return response;
    }

    if (req.method === "GET" && IS_CLIENTES_EXTRATO.test(req.url)) {
      const result = await handleExtrato(req);
      const response = new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: {
          "Content-Type": "application/json",
        },
      })
      return response;
    }

    if (req.method === "GET" && req.url === "/health") {
      const result = await handleHealth(req);
      const response = new Response(null, {
        status: result.status,
      })
      return response
    }
  },
})

