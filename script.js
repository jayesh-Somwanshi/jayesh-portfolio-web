const root = document.body;
const themeToggle = document.getElementById("themeToggle");
const toast = document.getElementById("toast");
const filterButtons = document.querySelectorAll(".filter-button");
const projectCards = document.querySelectorAll(".project-card");
const copyButtons = document.querySelectorAll("[data-copy]");
const contactForm = document.getElementById("contactForm");
const visualSlides = document.querySelectorAll("[data-visual-slide]");
const visualDots = document.querySelectorAll("[data-visual-dot]");
const visualShowcase = document.getElementById("visualShowcase");
const ragChatToggle = document.getElementById("ragChatToggle");
const ragChatPanel = document.getElementById("ragChatPanel");
const ragChatClose = document.getElementById("ragChatClose");
const ragChatForm = document.getElementById("ragChatForm");
const ragChatInput = document.getElementById("ragChatInput");
const ragChatMessages = document.getElementById("ragChatMessages");

const storedTheme = localStorage.getItem("portfolio-theme");
if (storedTheme) {
  root.dataset.theme = storedTheme;
}

function updateThemeButton() {
  const isLight = root.dataset.theme === "light";
  themeToggle.textContent = isLight ? "L" : "D";
  themeToggle.title = isLight ? "Switch to dark theme" : "Switch to light theme";
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2200);
}

themeToggle?.addEventListener("click", () => {
  const nextTheme = root.dataset.theme === "light" ? "dark" : "light";
  root.dataset.theme = nextTheme;
  localStorage.setItem("portfolio-theme", nextTheme);
  updateThemeButton();
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.filter;
    filterButtons.forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");

    projectCards.forEach((card) => {
      const matches = filter === "all" || card.dataset.category === filter;
      card.classList.toggle("is-hidden", !matches);
    });
  });
});

copyButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy || "");
      showToast("Copied to clipboard");
    } catch (error) {
      showToast("Clipboard access failed");
    }
  });
});

if (visualSlides.length > 0) {
  let activeVisualIndex = 0;
  let visualIntervalId;

  const renderVisualSlide = (index) => {
    activeVisualIndex = index;
    visualSlides.forEach((slide, slideIndex) => {
      slide.classList.toggle("is-active", slideIndex === index);
    });
    visualDots.forEach((dot, dotIndex) => {
      dot.classList.toggle("is-active", dotIndex === index);
    });
  };

  const startVisualRotation = () => {
    window.clearInterval(visualIntervalId);
    visualIntervalId = window.setInterval(() => {
      const nextIndex = (activeVisualIndex + 1) % visualSlides.length;
      renderVisualSlide(nextIndex);
    }, 3200);
  };

  visualDots.forEach((dot, index) => {
    dot.addEventListener("click", () => {
      renderVisualSlide(index);
      startVisualRotation();
    });
  });

  visualShowcase?.addEventListener("mouseenter", () => {
    window.clearInterval(visualIntervalId);
  });

  visualShowcase?.addEventListener("mouseleave", () => {
    startVisualRotation();
  });

  renderVisualSlide(0);
  startVisualRotation();
}

contactForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = document.getElementById("contactName").value.trim();
  const email = document.getElementById("contactEmail").value.trim();
  const message = document.getElementById("contactMessage").value.trim();

  const subject = `Portfolio inquiry from ${name || "Hiring Team"}`;
  const body =
    `Name: ${name || "-"}\nEmail: ${email || "-"}\n\nMessage:\n${message || "-"}`
  ;

  const gmailParams = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: "jayeshsomwanshi29@gmail.com",
    su: subject,
    body,
  });
  const gmailComposeUrl = `https://mail.google.com/mail/?${gmailParams.toString()}`;
  window.open(gmailComposeUrl, "_blank", "noopener");
});

function setRagChatOpen(isOpen) {
  ragChatPanel?.setAttribute("aria-hidden", String(!isOpen));
  ragChatToggle?.setAttribute("aria-expanded", String(isOpen));
  ragChatToggle?.classList.toggle("is-hidden", isOpen);

  if (isOpen) {
    window.setTimeout(() => ragChatInput?.focus(), 80);
  }
}

function addRagMessage(message, type) {
  const messageEl = document.createElement("article");
  messageEl.className = `rag-message rag-message-${type}`;
  messageEl.textContent = message;
  ragChatMessages?.appendChild(messageEl);
  ragChatMessages.scrollTop = ragChatMessages.scrollHeight;
  return messageEl;
}

function createTypewriter(messageEl) {
  let queuedText = "";
  let visibleText = "";
  let isTyping = false;
  let resolveIdle;
  let idlePromise = Promise.resolve();

  const typeNext = () => {
    if (!queuedText) {
      isTyping = false;
      resolveIdle?.();
      resolveIdle = undefined;
      return;
    }

      const nextMatch = queuedText.match(/^\s+|^\S+\s*/);
      const nextText = nextMatch?.[0] || queuedText[0];
      queuedText = queuedText.slice(nextText.length);
      visibleText += nextText;
      messageEl.classList.remove("rag-message-thinking");
      messageEl.textContent = visibleText;
      ragChatMessages.scrollTop = ragChatMessages.scrollHeight;

    window.setTimeout(typeNext, 45);
  };

  return {
    push(text) {
      if (!text) {
        return;
      }

      queuedText += text;

      if (!isTyping) {
        isTyping = true;
        idlePromise = new Promise((resolve) => {
          resolveIdle = resolve;
        });
        typeNext();
      }
    },
    async finish() {
      await idlePromise;
      return visibleText;
    },
  };
}

ragChatToggle?.addEventListener("click", () => setRagChatOpen(true));
ragChatClose?.addEventListener("click", () => setRagChatOpen(false));

ragChatForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = ragChatInput.value.trim();
  if (!message) {
    return;
  }

  addRagMessage(message, "user");
  ragChatInput.value = "";
  ragChatInput.disabled = true;
  const pendingMessage = addRagMessage("Thinking", "bot");
  pendingMessage.classList.add("rag-message-thinking");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Accept": "text/plain",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    });
    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      const data = contentType.includes("application/json")
        ? await response.json()
        : { error: await response.text() };
      throw new Error(data.error || "Unable to answer right now.");
    }

    if (!response.body) {
      throw new Error("Streaming is not supported in this browser.");
    }

    const typewriter = createTypewriter(pendingMessage);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      typewriter.push(decoder.decode(value, { stream: true }));
    }

    typewriter.push(decoder.decode());
    const finalText = await typewriter.finish();
    if (!finalText.trim()) {
      pendingMessage.textContent = "No answer returned.";
    }
  } catch (error) {
    pendingMessage.textContent = error.message || "Unable to answer right now.";
  } finally {
    ragChatInput.disabled = false;
    ragChatInput.focus();
  }
});

updateThemeButton();
