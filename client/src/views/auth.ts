import type { SessionUser } from "../../../shared/types.d.ts";
import { $, h, avatarEl, setLoading } from "../dom.ts";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../config.ts";
import { login, register } from "../api.ts";

// Sign in / create account. onSignedIn(user) runs after either succeeds.
export const initAuth = ({ onSignedIn }: { onSignedIn: (user: SessionUser) => void }) => {
  const loginForm = $<HTMLFormElement>("#login-form");
  const registerForm = $<HTMLFormElement>("#register-form");

  const showTab = (name: "login" | "register") => {
    const isLogin = name === "login";
    $("#tab-login").classList.toggle("is-active", isLogin);
    $("#tab-register").classList.toggle("is-active", !isLogin);
    $("#tab-login").setAttribute("aria-selected", String(isLogin));
    $("#tab-register").setAttribute("aria-selected", String(!isLogin));
    loginForm.hidden = !isLogin;
    registerForm.hidden = isLogin;
    $("#demo-accounts").hidden = !isLogin || !DEMO_ACCOUNTS.length;
  };
  $("#tab-login").addEventListener("click", () => showTab("login"));
  $("#tab-register").addEventListener("click", () => showTab("register"));

  const submitWith = (form: HTMLFormElement, action: (fields: Record<string, string>) => Promise<SessionUser>) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const error = $(".form__error", form);
      error.hidden = true;
      if (!form.checkValidity()) {
        const invalid = $<HTMLInputElement>(":invalid", form);
        const label = invalid.closest(".field")?.querySelector("span")?.textContent ?? "This field";
        error.textContent = `${label}: ${invalid.validationMessage}`;
        error.hidden = false;
        invalid.focus();
        return;
      }
      const button = $<HTMLButtonElement>("button[type=submit]", form);
      setLoading(button, true);
      try {
        const fields = Object.fromEntries(
          [...new FormData(form)].map(([key, value]) => [key, String(value)]),
        );
        const user = await action(fields);
        form.reset();
        onSignedIn(user);
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : "Something went wrong";
        error.hidden = false;
      } finally {
        setLoading(button, false);
      }
    });
  };
  submitWith(loginForm, ({ email, password }) => login(email, password));
  submitWith(registerForm, (fields) => register(fields));

  const emailInput = $<HTMLInputElement>("input[name=email]", loginForm);
  const passwordInput = $<HTMLInputElement>("input[name=password]", loginForm);

  $("#demo-list").replaceChildren(
    ...DEMO_ACCOUNTS.map((account, i) => {
      const [firstName, lastName = ""] = account.name.split(" ");
      return h(
        "button",
        {
          type: "button",
          class: "demo-user",
          onclick: () => {
            emailInput.value = account.email;
            passwordInput.value = DEMO_PASSWORD;
            $<HTMLButtonElement>("button[type=submit]", loginForm).focus();
          },
        },
        avatarEl({ id: `demo-${i}-${account.email}`, firstName, lastName }, { size: "sm" }),
        h("span", { class: "demo-user__text" }, h("span", { class: "demo-user__name" }, account.name), h("span", { class: "demo-user__role" }, account.role)),
      );
    }),
  );
  showTab("login");
};

export const showAuth = (message?: string | null) => {
  $("#auth-screen").hidden = false;
  $("#app-screen").hidden = true;
  const error = $("#login-form .form__error");
  error.hidden = !message;
  error.textContent = message ?? "";
};
