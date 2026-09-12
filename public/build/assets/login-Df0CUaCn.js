import{c as q,r as A,j as t,F as G,H}from"./app-CTdHufbH.js";import{s as I}from"./utils-CniakhVd.js";import{I as O}from"./input-error-D_0-JdXv.js";import{S as T}from"./spinner-UJLQ2Roz.js";/* empty css            */import"./createLucideIcon-DlkG5iDy.js";function X(R){const e=q.c(37),{status:m}=R,[o,J]=A.useState("user"),F=o==="admin";let d;e[0]===Symbol.for("react.memo_cache_sentinel")?(d=[],e[0]=d):d=e[0],A.useLayoutEffect(Y,d);let f,p,u,x,h;e[1]===Symbol.for("react.memo_cache_sentinel")?(f=t.jsx(H,{title:"Log in"}),p=t.jsx("style",{children:`
                /* ---- Animations ---- */
                @keyframes login-fade-up {
                    from { opacity: 0; transform: translateY(28px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                @keyframes login-fade-in {
                    from { opacity: 0; }
                    to   { opacity: 1; }
                }
                @keyframes login-glow-pulse {
                    0%, 100% { opacity: 0.25; }
                    50%      { opacity: 0.45; }
                }
                .login-fade-1 { animation: login-fade-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) both; }
                .login-fade-2 { animation: login-fade-up 0.7s 0.18s cubic-bezier(0.16, 1, 0.3, 1) both; }
                .login-fade-5 { animation: login-fade-in 0.8s 0.48s ease-out both; }
                .login-glow-ambient { animation: login-glow-pulse 6s ease-in-out infinite; }

                /* ---- Grain texture ---- */
                .login-grain {
                    position: fixed;
                    inset: 0;
                    opacity: 0.04;
                    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
                    background-repeat: repeat;
                    background-size: 256px 256px;
                    pointer-events: none;
                    z-index: 50;
                }

                /* ---- Card inner border shimmer ---- */
                .login-card-border-top {
                    position: absolute;
                    inset-x: 0;
                    top: 0;
                    height: 1px;
                    background: linear-gradient(90deg, transparent 0%, oklch(0.6 0.16 65 / 0.45) 20%, oklch(0.6 0.16 65 / 0.6) 50%, oklch(0.6 0.16 65 / 0.45) 80%, transparent 100%);
                }

                /* ---- Reduced motion ---- */
                @media (prefers-reduced-motion: reduce) {
                    .login-fade-1,
                    .login-fade-2,
                    .login-fade-5 {
                        animation: none;
                        opacity: 1;
                    }
                    .login-glow-ambient { animation: none; opacity: 0.3; }
                }
            `}),u=t.jsx("div",{className:"login-grain","aria-hidden":"true"}),x=t.jsx("div",{className:"login-glow-ambient pointer-events-none fixed right-[15%] top-1/2 z-0 h-[600px] w-[600px] -translate-y-1/2 translate-x-1/4 rounded-full bg-[oklch(0.55_0.16_65/0.06)] blur-[140px]","aria-hidden":"true"}),h=t.jsx("div",{className:"fixed inset-0 bg-[oklch(0.07_0.006_260)]","aria-hidden":"true"}),e[1]=f,e[2]=p,e[3]=u,e[4]=x,e[5]=h):(f=e[1],p=e[2],u=e[3],x=e[4],h=e[5]);let g;e[6]===Symbol.for("react.memo_cache_sentinel")?(g=t.jsxs("div",{className:"login-fade-1 mb-6 text-center",children:[t.jsx("h1",{className:"text-sm font-light italic tracking-[0.08em] text-[oklch(0.55_0.005_260)]",style:{fontFamily:"'Cormorant Garamond', serif"},children:"#madebyelon"}),t.jsx("div",{className:"mx-auto mt-2.5 h-px w-6 bg-[oklch(0.6_0.16_65/0.25)]"})]}),e[6]=g):g=e[6];let _;e[7]===Symbol.for("react.memo_cache_sentinel")?(_=t.jsx("div",{className:"login-card-border-top","aria-hidden":"true"}),e[7]=_):_=e[7];let b;e[8]===Symbol.for("react.memo_cache_sentinel")?(b=t.jsx("legend",{className:"sr-only",children:"Account type"}),e[8]=b):b=e[8];let y;e[9]===Symbol.for("react.memo_cache_sentinel")?(y=()=>J("user"),e[9]=y):y=e[9];const E=`flex-1 rounded-md py-2 text-xs font-semibold uppercase tracking-[0.15em] transition-all duration-200 ${o==="user"?"bg-[oklch(0.6_0.16_65/0.15)] text-[oklch(0.78_0.13_65)] shadow-sm":"text-[oklch(0.58_0.005_260)] hover:text-[oklch(0.65_0.005_260)]"}`;let k;e[10]===Symbol.for("react.memo_cache_sentinel")?(k={fontFamily:"'JetBrains Mono', monospace"},e[10]=k):k=e[10];const C=o==="user";let s;e[11]!==E||e[12]!==C?(s=t.jsx("button",{type:"button",onClick:y,className:E,style:k,"aria-pressed":C,children:"Member"}),e[11]=E,e[12]=C,e[13]=s):s=e[13];let j;e[14]===Symbol.for("react.memo_cache_sentinel")?(j=()=>J("admin"),e[14]=j):j=e[14];const B=`flex-1 rounded-md py-2 text-xs font-semibold uppercase tracking-[0.15em] transition-all duration-200 ${o==="admin"?"bg-[oklch(0.6_0.16_65/0.15)] text-[oklch(0.78_0.13_65)] shadow-sm":"text-[oklch(0.58_0.005_260)] hover:text-[oklch(0.65_0.005_260)]"}`;let w;e[15]===Symbol.for("react.memo_cache_sentinel")?(w={fontFamily:"'JetBrains Mono', monospace"},e[15]=w):w=e[15];const M=o==="admin";let n;e[16]!==B||e[17]!==M?(n=t.jsx("button",{type:"button",onClick:j,className:B,style:w,"aria-pressed":M,children:"Admin"}),e[16]=B,e[17]=M,e[18]=n):n=e[18];let a;e[19]!==s||e[20]!==n?(a=t.jsxs("fieldset",{className:"mb-5",children:[b,t.jsxs("div",{className:"flex rounded-lg bg-[oklch(0.14_0.006_260)] p-0.5",children:[s,n]})]}),e[19]=s,e[20]=n,e[21]=a):a=e[21];let v,N;e[22]===Symbol.for("react.memo_cache_sentinel")?(v=I.form(),N=["password"],e[22]=v,e[23]=N):(v=e[22],N=e[23]);let l;e[24]!==F?(l=$=>{const{processing:z,errors:L}=$;return t.jsxs(t.Fragment,{children:[t.jsx("input",{type:"hidden",name:"name",value:F?"admin":"kain7"}),t.jsxs("div",{children:[t.jsx("label",{htmlFor:"password",className:"mb-1.5 block text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-[oklch(0.56_0.005_260)]",style:{fontFamily:"'JetBrains Mono', monospace"},children:"Password"}),t.jsx("input",{id:"password",type:"password",name:"password",required:!0,autoFocus:!0,autoComplete:"current-password",placeholder:"········",className:"w-full rounded-lg border border-[oklch(0.40_0.01_260)] bg-[oklch(0.12_0.006_260)] px-3.5 py-2.5 text-sm text-[oklch(0.88_0.01_90)] placeholder:text-[oklch(0.35_0.008_260)] outline-none transition-all duration-200 focus:border-[oklch(0.55_0.15_65/0.5)] focus:ring-2 focus:ring-[oklch(0.55_0.15_65/0.18)]",style:{fontFamily:"'JetBrains Mono', monospace"}})]}),t.jsx(O,{message:L.password??L.name}),t.jsxs("button",{type:"submit",disabled:z,className:"mt-1 flex items-center justify-center gap-2 rounded-lg bg-[oklch(0.6_0.16_65)] px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.15em] text-[oklch(0.97_0_0)] transition-all duration-200 hover:bg-[oklch(0.65_0.17_65)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",style:{fontFamily:"'JetBrains Mono', monospace"},children:[z&&t.jsx(T,{}),z?"Signing in":"Sign in"]})]})},e[24]=F,e[25]=l):l=e[25];let i;e[26]!==o||e[27]!==l?(i=t.jsx(G,{...v,resetOnSuccess:N,className:"flex flex-col gap-3",children:l},o),e[26]=o,e[27]=l,e[28]=i):i=e[28];let r;e[29]!==a||e[30]!==i?(r=t.jsx("div",{className:"flex flex-1 items-center justify-center px-6",children:t.jsxs("div",{className:"w-full max-w-[320px]",children:[g,t.jsxs("div",{className:"login-fade-2 relative overflow-hidden rounded-2xl border border-[oklch(0.26_0.01_260)] bg-[oklch(0.095_0.006_260)] p-6 shadow-2xl shadow-black/40",children:[_,a,i]})]})}),e[29]=a,e[30]=i,e[31]=r):r=e[31];let c;e[32]!==m?(c=m&&t.jsx("p",{className:"login-fade-5 absolute bottom-10 left-1/2 -translate-x-1/2 text-center text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-[oklch(0.65_0.15_150)]",style:{fontFamily:"'JetBrains Mono', monospace"},children:m}),e[32]=m,e[33]=c):c=e[33];let S;return e[34]!==r||e[35]!==c?(S=t.jsxs(t.Fragment,{children:[f,p,u,x,h,t.jsxs("main",{className:"relative z-10 flex min-h-svh flex-col",children:[r,c]})]}),e[34]=r,e[35]=c,e[36]=S):S=e[36],S}function Y(){return document.documentElement.classList.add("page-login"),P}function P(){return document.documentElement.classList.remove("page-login")}export{X as default};
