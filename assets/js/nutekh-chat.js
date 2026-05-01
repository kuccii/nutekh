/**
 * Floating chat drawer: WhatsApp / email shortcuts + POST /api/contact (JSON).
 */
(function () {
  "use strict";

  var root = document.getElementById("nutekh-chat-root");
  if (!root) return;

  var backdrop = root.querySelector(".nutekh-chat-panel-backdrop");
  var panel = root.querySelector(".nutekh-chat-panel");
  var toggle = document.getElementById("nutekh-chat-toggle");
  var btnClose = root.querySelector(".nutekh-chat-close");
  var form = document.getElementById("nutekh-chat-form");
  var fb = root.querySelector("#nutekh-chat-feedback");
  var lastFocus = null;

  function isOpen() {
    return root.classList.contains("is-open");
  }

  function setOpen(open) {
    root.classList.toggle("is-open", open);
    document.body.classList.toggle("nutekh-chat-panel-open", open);
    root.setAttribute("aria-hidden", open ? "false" : "true");
    if (toggle) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
    if (panel) {
      if (open) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "");
    }
    if (!open && lastFocus && typeof lastFocus.focus === "function") {
      try {
        lastFocus.focus();
      } catch (_) {
        /* noop */
      }
    }
    if (open && btnClose) {
      setTimeout(function () {
        try {
          btnClose.focus();
        } catch (_) {}
      }, 320);
    }
  }

  function togglePanel() {
    lastFocus = document.activeElement;
    setOpen(!isOpen());
  }

  function trapKey(e) {
    if (!isOpen() || !panel) return;
    if (e.key === "Escape") {
      setOpen(false);
      if (toggle) toggle.focus();
      return;
    }
    if (e.key !== "Tab") return;

    var f = panel.querySelectorAll(
      'button:not([disabled]), [href]:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
    );
    var nodes = [];
    for (var i = 0; i < f.length; i++) {
      if (!f[i].hasAttribute("hidden") && f[i].closest("[hidden]") === null) {
        nodes.push(f[i]);
      }
    }
    if (!nodes.length) return;

    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    var cur = document.activeElement;

    if (e.shiftKey) {
      if (cur === first || !panel.contains(cur)) {
        last.focus();
        e.preventDefault();
      }
    } else {
      if (cur === last) {
        first.focus();
        e.preventDefault();
      }
    }
  }

  if (toggle)
    toggle.addEventListener("click", function () {
      togglePanel();
    });
  if (btnClose)
    btnClose.addEventListener("click", function () {
      setOpen(false);
      if (toggle) toggle.focus();
    });
  if (backdrop)
    backdrop.addEventListener("click", function () {
      setOpen(false);
      if (toggle) toggle.focus();
    });
  document.addEventListener("keydown", trapKey);

  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var name = (
        form.querySelector('[name="name"]') && form.querySelector('[name="name"]').value.trim()
      ) || "";
      var email = (
        form.querySelector('[name="email"]') && form.querySelector('[name="email"]').value.trim()
      ) || "";
      var message = (
        form.querySelector('[name="message"]') && form.querySelector('[name="message"]').value.trim()
      ) || "";
      var website = "";
      var wh = form.querySelector('[name="website"]');
      if (wh) website = wh.value.trim();

      var subjEl = form.querySelector('[name="subject"]');
      var subject = subjEl ? subjEl.value.trim() : "";

      if (!name || !email || !message) {
        if (fb) {
          fb.setAttribute(
            "data-state",
            "err"
          );
          fb.textContent =
            document.documentElement.lang === "sw"
              ? "Jaza jina, barua pepe na ujumbe."
              : "Please fill in name, email, and message.";
        }
        return;
      }

      var btn = form.querySelector('[type="submit"]');
      if (btn) {
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
      }

      if (fb) {
        fb.textContent = "";
        fb.removeAttribute("data-state");
      }

      fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name: name,
          email: email,
          message: message,
          subject: subject,
          website: website,
        }),
      })
        .then(function (res) {
          return res
            .json()
            .catch(function () {
              return {};
            })
            .then(function (j) {
              return { ok: res.ok && j && j.ok, json: j || {} };
            });
        })
        .then(function (_ref) {
          var ok = _ref.ok,
            json = _ref.json;
          if (ok) {
            if (fb) {
              fb.setAttribute("data-state", "ok");
              fb.textContent =
                json && json.message
                  ? json.message
                  : document.documentElement.lang === "sw"
                    ? "Asante — tutajibu hivi karibuni."
                    : "Thanks—we will reply soon.";
            }
            form.reset();
          } else {
            var msg =
              (json && json.message) ||
              (document.documentElement.lang === "sw"
                ? "Haijatumika. Jaribu WhatsApp au barua pepe."
                : "Could not send. Try WhatsApp or email.");
            if (fb) {
              fb.setAttribute("data-state", "err");
              fb.textContent = msg;
            }
          }
        })
        .catch(function () {
          if (fb) {
            fb.setAttribute("data-state", "err");
            fb.textContent =
              document.documentElement.lang === "sw"
                ? "Hitilafu ya mtandao. Jaribu tena baadaye."
                : "Network error. Try again.";
          }
        })
        .finally(function () {
          if (btn) {
            btn.disabled = false;
            btn.removeAttribute("aria-busy");
          }
        });
    });
  }
})();
