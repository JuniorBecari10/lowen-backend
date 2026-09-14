import express from "express";
import cors from "cors";

const port = 8080;
const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello, world! Servidor rodando liso.");
});

// ENDPOINT 1: CÁLCULO TRIBUTÁRIO ESPERADO (/calculo-tributo)

app.post("/calculo-tributo", (req, res) => {

  const { valorOperacao, aliquotaIBS, aliquotaCBS } = req.body;

  if (!valorOperacao || aliquotaIBS === undefined || aliquotaCBS === undefined) {
    return res.status(400).json({ erro: "Dados incompletos para a operação fiscal." });
  }

  const ibsEsperado = valorOperacao * (aliquotaIBS / 100);
  const cbsEsperado = valorOperacao * (aliquotaCBS / 100);
  const valorTributarioEsperado = ibsEsperado + cbsEsperado;

  return res.json({
    valorOperacao,
    tributos: {
      ibsEsperado,
      cbsEsperado,
      valorTributarioEsperado
    },
    status: "Pronto para correlação com a liquidação financeira"
  });
});

// ENDPOINT 2: DETECÇÃO DE ANOMALIAS NO SPLIT PAYMENT 

app.post("/verificar-anomalia", (req, res) => {

  const { idOperacao, valorTributarioEsperado, valorLiquidado } = req.body;

  if (!idOperacao || valorTributarioEsperado === undefined || valorLiquidado === undefined) {
    return res.status(400).json({ erro: "Dados incompletos para a verificação de anomalias." });
  }

  const diferenca = Math.abs(valorTributarioEsperado - valorLiquidado);
  const margemTolerancia = 0.05; // 

  if (diferenca > margemTolerancia) {
    return res.json({
      idOperacao,
      status: "Potencialmente Anômala",
      mensagem: `Divergência identificada. Esperado: ${valorTributarioEsperado} | Liquidado: ${valorLiquidado}`,
      alerta: true
    });
  }

  return res.json({
    idOperacao,
    status: "Operação Consistente",
    mensagem: "Os valores fiscais e da liquidação financeira são compatíveis.",
    alerta: false
  });
});

app.listen(port, () => {
  console.log(`Listening on port ${port}...`);
});