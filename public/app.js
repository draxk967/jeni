const chatBody = document.getElementById('chat-body');
const chatTitle = document.getElementById('chat-title');
const chatSubtitle = document.querySelector('.topbar-subtitle');
const restartButton = document.getElementById('restart-flow');
const messageInput = document.getElementById('message-input');
const sendMessageButton = document.getElementById('send-message');
const topbarAvatar = document.querySelector('.topbar-avatar');

const BOT_DISPLAY_NAME = 'Putinha da Roça';

const INITIAL_VIDEO_URL = 'https://cdnflexionpay.com/static/uploads/122765/4560/f4648490-5569-45fc-9fa0-0175e44cf24d_f910d4e4-31bd-4e74-a9cf-0857fd17fe9e_5774a15f-0130-4c62-9991-5ceef12544ba.mp4';

const MANUAL_RESPONSE_VIDEO_URL = 'https://cdnflexionpay.com/static/uploads/122765/4560/4665e9d2-d9a1-40fc-a1c1-4c9cd98ad063_c7eddb2f-2833-4918-8ca1-d79db87d8eb2_fa53663a-45f8-4e27-a447-866dfe6027de.MP4';

const MANUAL_RESPONSE_COPY = `💋 TO TE ESPERANDO PRA GOZAR 💋 

Essa é minha última mensagem pra você sobre o VIP 😘

Se quiser entrar agora sem pensar muito, o plano mais simples libera o acesso imediatamente 🔥

Depois disso eu paro de avisar, tá? 😌
Quando quiser, tô aqui 💕`;

const urlParams = new URLSearchParams(window.location.search);
const debugSpeed = urlParams.get('test') === '1'
  ? 30
  : Math.max(Number(urlParams.get('debugSpeed') || '1') || 1, 1);

let flow = null;
let remarketingTimerIds = [];
let latestPaymentState = null;
let hasManualResponseBeenSent = false;

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}


function setChatHeader() {
  if (chatTitle) {
    chatTitle.textContent = BOT_DISPLAY_NAME;
  }

  if (chatSubtitle) {
    chatSubtitle.textContent = '';
    chatSubtitle.hidden = true;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatTime(date = new Date()) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatBubbleText(text) {
  return escapeHtml(text ?? '').replace(/\n/g, '<br>');
}

function trackInteraction() {
  const payload = JSON.stringify({
    source: 'telegram_fake',
    url: window.location.href
  });

  if (navigator.sendBeacon) {
    const blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon('https://hot-dash-one.vercel.app/api/track-click', blob);
    return;
  }

  void fetch('https://hot-dash-one.vercel.app/api/track-click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload
  }).catch(() => {
    // Falha silenciosa para não impactar a experiência do usuário.
  });
}

function resolveMediaSrc(path) {
  if (!path) {
    return null;
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `/${String(path).replace(/^\/+/, '')}`;
}

function scrollToBottom() {
  chatBody.scrollTop = chatBody.scrollHeight;
}

function createBubble({
  type = 'in',
  html = '',
  timeLabel = formatTime(),
  buttons = [],
  media = null,
  id = null,
  statusText = '',
  statusClass = '',
  classNames = []
}) {
  const bubble = document.createElement('article');
  bubble.className = `bubble is-${type}`;

  if (classNames.length > 0) {
    bubble.classList.add(...classNames);
  }

  if (buttons.length > 0) {
    bubble.classList.add('with-reply-markup');
  }

  if (media) {
    bubble.classList.add('has-media', `has-${media.type}`, 'media-enter');
  }

  if (id) {
    bubble.dataset.bubbleId = id;
  }

  const body = document.createElement('div');
  body.className = 'bubble-body';

  if (type === 'service') {
    body.innerHTML = html;
    bubble.appendChild(body);
    return bubble;
  }

  if (media) {
    body.appendChild(renderMedia(media));
  }

  if (html) {
    const text = document.createElement('div');
    text.className = 'bubble-text';
    text.innerHTML = html;
    body.appendChild(text);
  }

  const statusNode = document.createElement('div');
  statusNode.className = `payment-status ${statusClass}`.trim();
  statusNode.textContent = statusText;
  statusNode.hidden = !statusText;
  body.appendChild(statusNode);

  const meta = document.createElement('div');
  meta.className = 'bubble-meta';
  meta.textContent = timeLabel;
  body.appendChild(meta);

  bubble.appendChild(body);

  if (buttons.length > 0) {
    const markup = document.createElement('div');
    markup.className = 'reply-markup';

    for (const buttonConfig of buttons) {
      const row = document.createElement('div');
      row.className = 'reply-row';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'reply-button';
      button.textContent = buttonConfig.label;
      button.dataset.action = buttonConfig.action;

      if (buttonConfig.actionPayload) {
        button.dataset.payload = JSON.stringify(buttonConfig.actionPayload);
      }

      row.appendChild(button);
      markup.appendChild(row);
    }

    bubble.appendChild(markup);
  }

  return bubble;
}

function openInAppVideoViewer(src) {
  if (!src) {
    return;
  }

  trackInteraction();
  const previousViewer = document.querySelector('.video-viewer');
  if (previousViewer) {
    previousViewer.remove();
  }

  const tgChat = document.querySelector('.tg-chat') || document.body;

  const viewer = document.createElement('div');
  viewer.className = 'video-viewer';

  viewer.innerHTML = `
    <div class="video-viewer-backdrop"></div>

    <div class="video-viewer-panel" role="dialog" aria-modal="true" aria-label="Visualizador de vídeo">
      <button class="video-viewer-close" type="button" aria-label="Fechar vídeo">×</button>

      <video class="video-viewer-player" controls playsinline autoplay>
        <source src="${escapeHtml(src)}" type="video/mp4">
      </video>
    </div>
  `;

  tgChat.appendChild(viewer);

  const player = viewer.querySelector('.video-viewer-player');
  const closeButton = viewer.querySelector('.video-viewer-close');
  const backdrop = viewer.querySelector('.video-viewer-backdrop');

  function closeViewer() {
    player.pause();
    viewer.remove();
  }

  closeButton.addEventListener('click', closeViewer);
  backdrop.addEventListener('click', closeViewer);

  const handleEscape = (event) => {
    if (event.key === 'Escape') {
      closeViewer();
      document.removeEventListener('keydown', handleEscape);
    }
  };

  document.addEventListener('keydown', handleEscape);

  player.muted = false;
  player.defaultMuted = false;
  player.volume = 1;
  player.controls = true;

  const playPromise = player.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {
      player.controls = true;
    });
  }
}

function renderMedia(media) {
  const wrapper = document.createElement('div');
  wrapper.className = `media-shell is-${media.type}`;

  const fallback = document.createElement('div');
  fallback.className = 'media-fallback';
  fallback.innerHTML = media.type === 'video'
    ? 'Carregando vídeo...'
    : 'QR CODE indisponível.';
  wrapper.appendChild(fallback);

  if (media.duration) {
    const badge = document.createElement('span');
    badge.className = 'media-duration';
    badge.textContent = media.duration;
    wrapper.appendChild(badge);
  }

  if (!media.src) {
    fallback.innerHTML = media.type === 'video'
      ? 'Vídeo indisponível.'
      : 'QR CODE indisponível.';
    return wrapper;
  }

  if (media.type === 'video') {
    const video = document.createElement('video');
    video.className = 'media-asset';
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.controls = false;

    try {
      video.disablePictureInPicture = true;
    } catch {
      // Ignora navegadores que não suportam.
    }

    const source = document.createElement('source');
    source.src = media.src;
    source.type = 'video/mp4';

    video.appendChild(source);

    const markLoaded = () => {
      wrapper.classList.add('is-loaded');

      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          wrapper.classList.add('autoplay-blocked');
        });
      }
    };

    video.addEventListener('loadedmetadata', markLoaded, { once: true });
    video.addEventListener('canplay', markLoaded, { once: true });

    video.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      openInAppVideoViewer(media.src);
    });

    video.addEventListener('error', () => {
      wrapper.classList.remove('is-loaded');
      fallback.innerHTML = 'Vídeo indisponível.';
    });

    wrapper.appendChild(video);
    video.load();

    return wrapper;
  }

  const image = document.createElement('img');
  image.className = 'media-asset';
  image.src = media.src;
  image.alt = media.alt || '';

  image.addEventListener('load', () => {
    wrapper.classList.add('is-loaded');
  });

  image.addEventListener('error', () => {
    wrapper.classList.remove('is-loaded');
    fallback.innerHTML = 'Imagem indisponível.';
  });

  wrapper.appendChild(image);
  return wrapper;
}

function addBubble(config, options = {}) {
  const bubble = createBubble(config);
  chatBody.appendChild(bubble);

  if (options.scroll !== false) {
    scrollToBottom();
  }

  return bubble;
}

function resetView() {
  chatBody.innerHTML = '';
  latestPaymentState = null;
  hasManualResponseBeenSent = false;
  setChatHeader();

  if (remarketingTimerIds.length > 0) {
    for (const timerId of remarketingTimerIds) {
      window.clearTimeout(timerId);
    }

    remarketingTimerIds = [];
  }

  const previousViewer = document.querySelector('.video-viewer');
  if (previousViewer) {
    previousViewer.remove();
  }
}

async function fetchFlow() {
  const response = await fetch('/api/flow');

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: 'Não foi possível carregar o fluxo.' }));

    throw new Error(error.message || 'Não foi possível carregar o fluxo.');
  }

  return response.json();
}

function paymentMessageHtml(payment) {
  return [
    `<strong>Plano:</strong> ${escapeHtml(payment.plan.nome)}`,
    `<strong>Valor:</strong> ${escapeHtml(payment.plan.valorFormatado)}`,
    '',
    '<strong>Pague via Pix Copia e Cola</strong> (Clique Abaixo Para Copiar):',
    `<div class="quote-card"><code>${escapeHtml(payment.pixCode)}</code></div>`
  ].join('<br>');
}

function getPrincipalButtons() {
  return Array.isArray(flow?.principal?.plans)
    ? flow.principal.plans.map((plan) => ({
        label: `${plan.nome} - ${plan.valorFormatado}`,
        action: 'buy-plan',
        actionPayload: { offerId: plan.offerId }
      }))
    : [];
}

function getManualResponseButton() {
  const principalPlans = Array.isArray(flow?.principal?.plans)
    ? flow.principal.plans
    : [];

  const premiumPlan =
    principalPlans.find((plan) => Math.abs(Number(plan.valor) - 34.9) < 0.01) ||
    principalPlans.find((plan) => String(plan.nome || '').toUpperCase().includes('PREMIUM')) ||
    principalPlans[1] ||
    principalPlans[0] ||
    null;

  if (!premiumPlan) {
    return [];
  }

  return [
    {
      label: `${premiumPlan.nome} - R$ 34,90`,
      action: 'buy-plan',
      actionPayload: { offerId: premiumPlan.offerId }
    }
  ];
}

async function renderInitialSequence() {
  setChatHeader();

  addBubble({
    type: 'service',
    html: 'Hoje'
  }, { scroll: false });

  addBubble({
    type: 'in',
    html: formatBubbleText(flow.principal.texto),
    timeLabel: formatTime(),
    media: {
      type: 'video',
      duration: '0:11',
      src: INITIAL_VIDEO_URL
    },
    buttons: getPrincipalButtons()
  }, { scroll: false });

  window.requestAnimationFrame(() => {
    chatBody.scrollTop = 0;
  });
}

async function createPix(offerId, button) {
  const originalLabel = button?.textContent || '';

  if (button) {
    button.disabled = true;
    button.textContent = 'Gerando PIX...';
  }

  trackInteraction();

  try {
    const response = await fetch('/api/payments/pix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ offerId })
    });

    const payment = await response.json();

    if (!response.ok) {
      throw new Error(payment.message || 'Falha ao gerar PIX.');
    }

    latestPaymentState = payment;

    addBubble({
      id: payment.transactionId,
      type: 'in',
      html: paymentMessageHtml(payment),
      timeLabel: formatTime(),
      buttons: [
        {
          label: flow.payment.verifyButton,
          action: 'verify-payment',
          actionPayload: { transactionId: payment.transactionId }
        },
        {
          label: flow.payment.copyButton,
          action: 'copy-pix',
          actionPayload: { pixCode: payment.pixCode }
        },
        {
          label: flow.payment.scanButton,
          action: 'show-qr',
          actionPayload: { transactionId: payment.transactionId }
        }
      ],
      statusText: 'Status: aguardando pagamento',
      statusClass: 'is-pending',
      classNames: ['is-payment']
    });

    scheduleRemarketing(payment.transactionId);
  } catch (error) {
    window.alert(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

function updateBubbleStatus(transactionId, text, statusClass) {
  const bubble = chatBody.querySelector(`[data-bubble-id="${transactionId}"]`);

  if (!bubble) {
    return;
  }

  const statusNode = bubble.querySelector('.payment-status');

  if (!statusNode) {
    return;
  }

  statusNode.hidden = false;
  statusNode.className = `payment-status ${statusClass}`.trim();
  statusNode.textContent = text;
}

async function verifyPayment(transactionId, button) {
  button.disabled = true;

  try {
    const response = await fetch(`/api/payments/${transactionId}`);
    const payment = await response.json();

    if (!response.ok) {
      throw new Error(payment.message || 'Falha ao verificar pagamento.');
    }

    latestPaymentState = { ...latestPaymentState, ...payment };

    if (payment.status === 'COMPLETED') {
      updateBubbleStatus(transactionId, 'Status: pagamento confirmado', 'is-success');

      if (remarketingTimerIds.length > 0) {
        for (const timerId of remarketingTimerIds) {
          window.clearTimeout(timerId);
        }

        remarketingTimerIds = [];
      }
    } else if (payment.status === 'PENDING') {
      updateBubbleStatus(transactionId, 'Status: aguardando pagamento', 'is-pending');
    } else {
      updateBubbleStatus(transactionId, `Status: ${payment.status}`, 'is-pending');
    }
  } catch (error) {
    window.alert(error.message);
  } finally {
    button.disabled = false;
  }
}

async function copyPixCode(pixCode) {
  trackInteraction();
  await navigator.clipboard.writeText(pixCode);
}

function showQrBubble() {
  trackInteraction();

  if (!latestPaymentState?.qrBase64) {
    window.alert('QR CODE indisponível para esta cobrança.');
    return;
  }

  const qrBubbleId = `qr-${latestPaymentState.transactionId}`;

  if (chatBody.querySelector(`[data-bubble-id="${qrBubbleId}"]`)) {
    scrollToBottom();
    return;
  }

  addBubble({
    id: qrBubbleId,
    type: 'in',
    html: escapeHtml(flow.payment.qrCaption),
    timeLabel: formatTime(),
    media: {
      type: 'image',
      src: `data:image/png;base64,${latestPaymentState.qrBase64}`,
      alt: 'QR CODE do pagamento'
    }
  });
}

function scheduleRemarketing(transactionId) {
  const steps = Array.isArray(flow.remarketing.steps) ? flow.remarketing.steps : [];

  if (!flow.remarketing.enabled || steps.length === 0) {
    return;
  }

  if (remarketingTimerIds.length > 0) {
    for (const timerId of remarketingTimerIds) {
      window.clearTimeout(timerId);
    }
  }

  remarketingTimerIds = [];

  for (const step of steps) {
    const delay = Math.max(1_000, (Number(step.delaySeconds || 0) * 1_000) / debugSpeed);

    const timerId = window.setTimeout(() => {
      if (!latestPaymentState || latestPaymentState.transactionId !== transactionId) {
        return;
      }

      if (latestPaymentState.status === 'COMPLETED') {
        return;
      }

      const remarketingBubbleId = `remarketing-${transactionId}-${step.order}`;

      if (chatBody.querySelector(`[data-bubble-id="${remarketingBubbleId}"]`)) {
        return;
      }

      addBubble({
        id: remarketingBubbleId,
        type: 'in',
        html: formatBubbleText(step.texto || ''),
        timeLabel: formatTime(),
        media: {
          type: 'video',
          duration: '0:00',
          src: resolveMediaSrc(step.mediaPath) || MANUAL_RESPONSE_VIDEO_URL
        },
        buttons: step.ctaPlan
          ? [
              {
                label: `${step.ctaPlan.nome} - ${step.ctaPlan.valorFormatado}`,
                action: 'buy-plan',
                actionPayload: { offerId: step.ctaPlan.offerId }
              }
            ]
          : []
      });
    }, delay);

    remarketingTimerIds.push(timerId);
  }
}

async function handleUserMessageSend() {
  const message = messageInput?.value?.trim();

  if (!message) {
    return;
  }

  trackInteraction();
  messageInput.value = '';

  addBubble({
    type: 'out',
    html: escapeHtml(message),
    timeLabel: formatTime()
  });

  if (hasManualResponseBeenSent) {
    return;
  }

  hasManualResponseBeenSent = true;

  await sleep(350);

  addBubble({
    type: 'in',
    html: formatBubbleText(MANUAL_RESPONSE_COPY),
    timeLabel: formatTime(),
    media: {
      type: 'video',
      duration: '0:00',
      src: MANUAL_RESPONSE_VIDEO_URL
    },
    buttons: getManualResponseButton()
  });
}

chatBody.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');

  if (!button) {
    return;
  }

  const payload = button.dataset.payload ? JSON.parse(button.dataset.payload) : {};

  if (button.dataset.action === 'buy-plan') {
    await createPix(payload.offerId, button);
    return;
  }

  if (button.dataset.action === 'verify-payment') {
    await verifyPayment(payload.transactionId, button);
    return;
  }

  if (button.dataset.action === 'copy-pix') {
    try {
      await copyPixCode(payload.pixCode);
      button.textContent = 'Chave copiada';

      window.setTimeout(() => {
        button.textContent = flow.payment.copyButton;
      }, 1500);
    } catch {
      window.alert('Não foi possível copiar a chave PIX.');
    }

    return;
  }

  if (button.dataset.action === 'show-qr') {
    showQrBubble();
  }
});

sendMessageButton?.addEventListener('click', handleUserMessageSend);

messageInput?.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter') {
    return;
  }

  event.preventDefault();
  await handleUserMessageSend();
});

function openProfileViewer() {
  const imageSrc = topbarAvatar?.querySelector('img')?.src;
  const displayName = BOT_DISPLAY_NAME;

  if (!imageSrc) {
    return;
  }

  const previousViewer = document.querySelector('.profile-viewer');
  if (previousViewer) {
    previousViewer.remove();
  }

  const tgChat = document.querySelector('.tg-chat') || document.body;
  const viewer = document.createElement('div');
  viewer.className = 'profile-viewer';

  viewer.innerHTML = `
    <div class="profile-viewer-backdrop"></div>
    <div class="profile-viewer-panel" role="dialog" aria-modal="true" aria-label="Foto de perfil">
      <button class="profile-viewer-close" type="button" aria-label="Fechar perfil">×</button>
      <div class="profile-viewer-header">${escapeHtml(displayName)}</div>
      <div class="profile-viewer-content">
        <img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(displayName)}">
      </div>
    </div>
  `;

  tgChat.appendChild(viewer);

  function closeViewer() {
    viewer.remove();
  }

  viewer.querySelector('.profile-viewer-close')?.addEventListener('click', closeViewer);
  viewer.querySelector('.profile-viewer-backdrop')?.addEventListener('click', closeViewer);
}

topbarAvatar?.addEventListener('click', openProfileViewer);

restartButton?.addEventListener('click', async () => {
  await bootstrap();
});

async function bootstrap() {
  resetView();
  flow = await fetchFlow();
  await renderInitialSequence();
}

bootstrap().catch((error) => {
  setChatHeader();
  chatBody.innerHTML = `<article class="bubble is-service"><div class="bubble-body">${escapeHtml(error.message)}</div></article>`;
});