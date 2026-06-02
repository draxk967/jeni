import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const STATIC_DIR = path.join(ROOT_DIR, 'static');
const OMEGA_ENV_PATH = path.join(ROOT_DIR, 'omegaenv.txt');
const JENNI_CONFIG_PATH = path.join(ROOT_DIR, 'config_jenniivip_bot.json');
const OMEGA_API_BASE_URL = 'https://app.omegapayments.com.br/api/v1';
const DEFAULT_PORT = Number(process.env.PORT || 3000);
const STATUS_CACHE_WINDOW_MS = 10_000;

const transactionCache = new Map();

function parseSimpleEnvFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const values = {};

  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (key) {
      values[key] = value;
    }
  }

  return values;
}

function getOmegaCredentials() {
  if (!fs.existsSync(OMEGA_ENV_PATH)) {
    throw new Error('Arquivo omegaenv.txt não encontrado.');
  }

  const envValues = parseSimpleEnvFile(OMEGA_ENV_PATH);
  const publicKey = process.env.OMEGA_PUBLIC_KEY || process.env.Client_ID || envValues.Client_ID;
  const secretKey = process.env.OMEGA_SECRET_KEY || process.env.Client_Secret || envValues.Client_Secret;

  if (!publicKey || !secretKey) {
    throw new Error('Credenciais da Omega Pay ausentes em omegaenv.txt.');
  }

  return { publicKey, secretKey };
}

function readJenniConfig() {
  const raw = fs.readFileSync(JENNI_CONFIG_PATH, 'utf8');
  const parsed = JSON.parse(raw);

  if (typeof parsed?.data === 'string') {
    return JSON.parse(parsed.data);
  }

  if (parsed?.data && typeof parsed.data === 'object') {
    return parsed.data;
  }

  return parsed;
}

function formatMoney(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(value));
}

function capitalizeBotName(arroba) {
  return String(arroba || 'jenniivip_bot')
    .replace(/_bot$/i, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildOfferId(scope, exportId, variant = 'default') {
  return `${scope}:${exportId}:${variant}`;
}

function normalizePlan(plan, overrides = {}) {
  if (!plan) {
    return null;
  }

  const valor = Number(overrides.valor ?? plan.valor);

  return {
    offerId: overrides.offerId || buildOfferId('plan', plan.export_id, plan.tipo || 'default'),
    exportId: plan.export_id,
    nome: overrides.nome || plan.nome,
    valor,
    valorFormatado: formatMoney(valor),
    tipo: overrides.tipo || plan.tipo,
    ativo: overrides.ativo ?? Boolean(plan.ativo),
    ordem: Number(overrides.ordem ?? plan.ordem ?? 0),
    corPlano: overrides.corPlano || plan.cor_plano || 'default'
  };
}

function normalizeCopy(copy) {
  if (!copy) {
    return {
      tipo: '',
      texto: '',
      midias: []
    };
  }

  return {
    tipo: copy.tipo,
    texto: copy.copy,
    midias: Array.isArray(copy.midias)
      ? copy.midias.map((media) => ({
          path: media.path,
          ordem: media.ordem
        }))
      : []
  };
}

function normalizeRemarketingStep(step, plans) {
  if (!step) {
    return null;
  }

  const stepPlans = Array.isArray(step.planos) ? step.planos : [];
  const stepMedias = Array.isArray(step.midias) ? step.midias : [];
  const ctaSource = stepPlans[0] || null;
  const basePlan = ctaSource
    ? plans.find((item) => item?.export_id === ctaSource.plano_export_id)
    : null;
  const ctaPlan = ctaSource
    ? normalizePlan(
        basePlan || {
          export_id: ctaSource.plano_export_id,
          nome: ctaSource.plano_nome,
          valor: ctaSource.valor_com_desconto,
          tipo: 'Remarketing',
          ativo: true,
          ordem: step.ordem,
          cor_plano: 'default'
        },
        {
          offerId: buildOfferId('remarketing', ctaSource.plano_export_id, step.ordem || 0),
          nome: ctaSource.plano_nome || basePlan?.nome,
          valor: Number(ctaSource.valor_com_desconto ?? basePlan?.valor ?? 0),
          tipo: 'Remarketing',
          ativo: true,
          ordem: Number(step.ordem || 0),
          corPlano: basePlan?.cor_plano || 'default'
        }
      )
    : null;

  return {
    order: Number(step.ordem || 0),
    delaySeconds: Number(step.delay_minutos || 0) * 60,
    texto: step.copy || '',
    mediaPath: stepMedias.sort((left, right) => Number(left?.ordem || 0) - Number(right?.ordem || 0))[0]?.path || null,
    ctaPlan
  };
}

function buildFlowPayload() {
  const config = readJenniConfig();
  const fronts = Array.isArray(config.fronts) ? config.fronts : [];
  const front = fronts.find((item) => item?.ativo) || fronts[0];

  if (!front) {
    throw new Error('Nenhum front ativo encontrado em config_jenniivip_bot.json.');
  }

  const copies = Array.isArray(front.copies) ? front.copies : [];
  const plans = Array.isArray(front.planos) ? front.planos : [];
  const remarketingFunnel = Array.isArray(front.funis?.remarketing) ? front.funis.remarketing : [];
  const principalCopy = normalizeCopy(copies.find((item) => item?.tipo === 'Principal'));
  const remarketingCopy = normalizeCopy(
    copies.find((item) => item?.tipo === 'Remarketing') ||
      copies.find((item) => item?.tipo === 'Downsell')
  );
  const principalPlans = plans
    .filter((item) => item?.ativo && item?.tipo === 'Principal')
    .map((item) => normalizePlan(item, { offerId: buildOfferId('principal', item.export_id, item.ordem || 0) }))
    .filter(Boolean)
    .sort((left, right) => left.ordem - right.ordem || left.exportId - right.exportId);
  const remarketingSteps = remarketingFunnel
    .map((item) => normalizeRemarketingStep(item, plans))
    .filter(Boolean)
    .sort((left, right) => left.order - right.order);
  const primaryRemarketingStep = remarketingSteps[0] || null;
  const fallbackRemarketingPlanSource = plans.find((item) => item?.ativo && item?.tipo === 'Downsell');
  const fallbackRemarketingPlan = fallbackRemarketingPlanSource
    ? normalizePlan(fallbackRemarketingPlanSource, {
        offerId: buildOfferId('remarketing', fallbackRemarketingPlanSource.export_id, 'fallback')
      })
    : null;
  const remarketingPlan = primaryRemarketingStep?.ctaPlan || fallbackRemarketingPlan;
  const remarketingDelaySeconds = primaryRemarketingStep?.delaySeconds || Number(front.remarketing_delay_segundos || 300);
  const remarketingText = primaryRemarketingStep?.texto || remarketingCopy.texto;
  const remarketingMediaPath = primaryRemarketingStep?.mediaPath || remarketingCopy.midias[0]?.path || null;
  const normalizedRemarketingSteps = remarketingSteps.length > 0
    ? remarketingSteps
    : remarketingPlan && remarketingText.trim()
      ? [
          {
            order: 1,
            delaySeconds: remarketingDelaySeconds,
            texto: remarketingText,
            mediaPath: remarketingMediaPath,
            ctaPlan: remarketingPlan
          }
        ]
      : [];

  return {
    bot: {
      id: config.bot?.bot_id || null,
      arroba: config.bot?.arroba || 'jenniivip_bot',
      nome: capitalizeBotName(config.bot?.arroba)
    },
    startCommand: '/start',
    principal: {
      texto: principalCopy.texto,
      mediaPath: principalCopy.midias[0]?.path || null,
      plans: principalPlans
    },
    payment: {
      qrCaption: 'Escaneie o QR CODE acima para pagar!',
      verifyButton: 'Verificar Pagamento',
      copyButton: 'Copiar chave PIX',
      scanButton: 'Escanear QR CODE'
    },
    remarketing: {
      enabled: front.remarketing_estado === 'on' || front.remarketing_estado === true,
      delaySeconds: remarketingDelaySeconds,
      texto: remarketingText,
      mediaPath: remarketingMediaPath,
      ctaPlan: remarketingPlan,
      steps: normalizedRemarketingSteps
    }
  };
}

function collectAvailableOffers(flow) {
  const offers = [...flow.principal.plans];

  if (Array.isArray(flow.remarketing?.steps)) {
    for (const step of flow.remarketing.steps) {
      if (step?.ctaPlan) {
        offers.push(step.ctaPlan);
      }
    }
  } else if (flow.remarketing?.ctaPlan) {
    offers.push(flow.remarketing.ctaPlan);
  }

  return offers;
}

async function omegaRequest(endpoint, options = {}) {
  const credentials = getOmegaCredentials();
  const method = options.method || 'GET';
  const headers = {
    'x-public-key': credentials.publicKey,
    'x-secret-key': credentials.secretKey,
    ...options.headers
  };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${OMEGA_API_BASE_URL}${endpoint}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const rawText = await response.text();
  let data;

  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = { rawText };
  }

  if (!response.ok) {
    const error = new Error(data.message || 'Falha na comunicação com a Omega Pay.');
    error.statusCode = response.status;
    error.payload = data;
    throw error;
  }

  return data;
}

function buildTestClient() {
  const token = Date.now().toString(36);

  return {
    name: 'Teste Local',
    email: `telegram.local+${token}@example.com`,
    phone: '11999999999',
    document: '11144477735'
  };
}

function normalizePixCreation(plan, omegaResponse) {
  return {
    transactionId: omegaResponse.transactionId || omegaResponse.id || null,
    plan: {
      offerId: plan.offerId,
      exportId: plan.exportId,
      nome: plan.nome,
      valor: plan.valor,
      valorFormatado: plan.valorFormatado
    },
    status: omegaResponse.status,
    fee: Number(omegaResponse.fee || 0),
    orderUrl: omegaResponse.order?.url || null,
    receiptUrl: omegaResponse.order?.receiptUrl || null,
    pixCode: omegaResponse.pix?.code || omegaResponse.pixInformation?.qrCode || null,
    qrBase64: omegaResponse.pix?.base64 || omegaResponse.pixInformation?.base64 || null,
    expiresAt: omegaResponse.pix?.expiresAt || null
  };
}

async function createPixCharge(plan) {
  const payload = {
    identifier: `jenniivip-local-${plan.exportId}-${Date.now()}`,
    amount: plan.valor,
    client: buildTestClient(),
    products: [
      {
        id: String(plan.exportId),
        name: plan.nome,
        quantity: 1,
        price: plan.valor
      }
    ],
    metadata: {
      source: 'local-telegram-flow',
      planExportId: plan.exportId,
      bot: 'jenniivip_bot'
    }
  };

  const omegaResponse = await omegaRequest('/gateway/pix/receive', {
    method: 'POST',
    body: payload
  });

  const normalized = normalizePixCreation(plan, omegaResponse);

  transactionCache.set(normalized.transactionId, {
    ...normalized,
    lastProviderSyncAt: Date.now()
  });

  return normalized;
}

function normalizeTransactionLookup(transactionId, omegaResponse, cached = {}) {
  return {
    transactionId,
    status: omegaResponse.status,
    paymentMethod: omegaResponse.paymentMethod,
    payedAt: omegaResponse.payedAt,
    createdAt: omegaResponse.createdAt,
    pixCode: omegaResponse.pixInformation?.qrCode || cached.pixCode || null,
    qrBase64: omegaResponse.pixInformation?.base64 || cached.qrBase64 || null,
    amount: Number(omegaResponse.amount || cached.plan?.valor || 0),
    chargeAmount: Number(omegaResponse.chargeAmount || 0),
    errorDescription: omegaResponse.errorDescription || null,
    plan: cached.plan || null
  };
}

async function getPaymentStatus(transactionId) {
  const cached = transactionCache.get(transactionId);

  if (cached && Date.now() - cached.lastProviderSyncAt < STATUS_CACHE_WINDOW_MS) {
    return {
      ...cached,
      cached: true
    };
  }

  const omegaResponse = await omegaRequest(`/gateway/transactions?id=${encodeURIComponent(transactionId)}`);
  const normalized = normalizeTransactionLookup(transactionId, omegaResponse, cached);

  transactionCache.set(transactionId, {
    ...cached,
    ...normalized,
    lastProviderSyncAt: Date.now()
  });

  return normalized;
}

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use('/static', express.static(STATIC_DIR));
app.use(express.static(PUBLIC_DIR));

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.get('/api/flow', (_request, response) => {
  try {
    response.json(buildFlowPayload());
  } catch (error) {
    response.status(500).json({
      message: error.message || 'Não foi possível montar o fluxo.'
    });
  }
});

app.post('/api/payments/pix', async (request, response) => {
  try {
    const flow = buildFlowPayload();
    const requestedOfferId = request.body?.offerId ? String(request.body.offerId) : null;
    const requestedExportId = Number(request.body?.planExportId);
    const availablePlans = collectAvailableOffers(flow);
    const plan = requestedOfferId
      ? availablePlans.find((item) => item.offerId === requestedOfferId)
      : availablePlans.find((item) => item.exportId === requestedExportId);

    if (!plan) {
      response.status(404).json({ message: 'Plano não encontrado.' });
      return;
    }

    const pixCharge = await createPixCharge(plan);
    response.status(201).json(pixCharge);
  } catch (error) {
    response.status(error.statusCode || 500).json({
      message: error.message || 'Não foi possível gerar o PIX.',
      details: error.payload || null
    });
  }
});

app.get('/api/payments/:transactionId', async (request, response) => {
  try {
    const paymentStatus = await getPaymentStatus(request.params.transactionId);
    response.json(paymentStatus);
  } catch (error) {
    response.status(error.statusCode || 500).json({
      message: error.message || 'Não foi possível consultar o pagamento.',
      details: error.payload || null
    });
  }
});

app.post('/api/webhooks/omegapay', (request, response) => {
  const transactionId = request.body?.id || request.body?.transactionId;

  if (transactionId && transactionCache.has(transactionId)) {
    const cached = transactionCache.get(transactionId);

    transactionCache.set(transactionId, {
      ...cached,
      status: request.body?.status || cached.status,
      payedAt: request.body?.payedAt || cached.payedAt || null,
      lastProviderSyncAt: Date.now()
    });
  }

  response.status(200).json({ ok: true });
});

app.get('*', (_request, response) => {
  response.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(DEFAULT_PORT, () => {
  console.log(`Servidor local disponível em http://localhost:${DEFAULT_PORT}`);
});
