// Política de privacidade servida em /privacidade (exigida pela Chrome Web Store).

export const PRIVACY_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vemo · Política de privacidade</title>
<style>
  :root { color-scheme: light dark; --bg: #fbf8f4; --text: #1d1a24; --muted: #5e5869; --accent: #d9482a; }
  @media (prefers-color-scheme: dark) { :root { --bg: #16131f; --text: #f5efe6; --muted: #a69fb4; --accent: #ff6b4a; } }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 system-ui, -apple-system, 'Segoe UI', sans-serif; }
  main { max-width: 680px; margin: 0 auto; padding: 48px 20px 64px; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  h2 { font-size: 18px; margin: 32px 0 8px; }
  p, li { color: var(--text); }
  .meta { color: var(--muted); margin: 0 0 24px; }
  a { color: var(--accent); }
</style>
</head>
<body>
<main>
  <h1>Política de privacidade do Vemo</h1>
  <p class="meta">Última atualização: 23 de outubro de 2026</p>

  <p>O Vemo é uma extensão de navegador que sincroniza play, pausa e posição de vídeos do YouTube e da Netflix entre pessoas que estão na mesma sala. Esta página explica quais dados passam pelo Vemo e o que acontece com eles.</p>

  <h2>O que o Vemo não faz</h2>
  <ul>
    <li>Não transmite, grava nem copia nenhum vídeo. Cada pessoa assiste na própria conta.</li>
    <li>Não lê suas senhas, dados de login, histórico de navegação ou qualquer página fora do YouTube e da Netflix.</li>
    <li>Não usa cookies, anúncios, rastreadores ou ferramentas de análise.</li>
    <li>Não vende nem compartilha dados com terceiros.</li>
  </ul>

  <h2>Dados que passam pelo servidor de salas</h2>
  <p>Enquanto você está numa sala, a extensão envia ao servidor de salas, e ele repassa às outras pessoas daquela sala:</p>
  <ul>
    <li>o nome que você escolheu nas configurações (opcional);</li>
    <li>o código da sala;</li>
    <li>o endereço e o título do vídeo aberto na aba sincronizada;</li>
    <li>se o vídeo está tocando ou pausado, a posição atual e se ele está carregando.</li>
  </ul>
  <p>O servidor guarda apenas o último estado do vídeo de cada sala, para que quem entrar depois comece no ponto certo. Esse registro é apagado automaticamente 30 minutos depois que a última pessoa sai da sala. O servidor roda na infraestrutura da Cloudflare.</p>

  <h2>Dados guardados no seu navegador</h2>
  <p>O nome que você escolheu e o endereço do servidor ficam salvos localmente no seu navegador, pela própria extensão. Eles são apagados quando você remove a extensão.</p>

  <h2>Contato</h2>
  <p>Dúvidas ou pedidos sobre seus dados: <a href="mailto:kawannmarcelo7@gmail.com">kawannmarcelo7@gmail.com</a>. O código-fonte é aberto: <a href="https://github.com/kaw7nn/vemo">github.com/kaw7nn/vemo</a>.</p>
</main>
</body>
</html>
`;
