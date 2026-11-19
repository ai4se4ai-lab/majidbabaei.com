% scholarpress-preprint.cls — ScholarPress house preprint style (article-based).
% Clear title/author block with affiliations, abstract, numbered sections, legible equations, linked references,
% and an optional, accurate preprint notice. No repository branding or identifiers.
%
%   \documentclass{scholarpress-preprint}           % or [notice={Preprint. Under review at Venue.}]
%   \title{...}  \author{Name}  \affiliation{Institution}  \author{Second}  \affiliation{...}
%   \preprintdate{2026-11-19}  % optional; defaults to \today
%   \maketitle  \begin{abstract} ... \end{abstract}
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{scholarpress-preprint}[2026/11/19 v1.0 ScholarPress house preprint]
\RequirePackage{kvoptions}
\SetupKeyvalOptions{family=SP,prefix=SP@}
\DeclareStringOption[]{notice}
\DeclareBoolOption{twocolumn}
\DeclareDefaultOption{\PassOptionsToClass{\CurrentOption}{article}}
\ProcessKeyvalOptions*
\LoadClass[11pt]{article}

\RequirePackage[T1]{fontenc}
\RequirePackage{lmodern}
\RequirePackage[letterpaper,margin=1in,headheight=14pt]{geometry}
\RequirePackage{amsmath,amssymb}
\RequirePackage{graphicx}
\RequirePackage{xcolor}
\RequirePackage[protrusion=true,expansion=false]{microtype}
\RequirePackage{fancyhdr}
\definecolor{spaccent}{HTML}{19375F}
\RequirePackage[colorlinks=true,linkcolor=spaccent,citecolor=spaccent,urlcolor=spaccent,pdfusetitle,bookmarksnumbered]{hyperref}

% Authors and affiliations ---------------------------------------------------------------
\newcounter{SP@author}
\newcommand\SP@authors{}
\renewcommand\author[1]{\stepcounter{SP@author}%
  \expandafter\def\csname SP@author@\theSP@author\endcsname{#1}%
  \expandafter\def\csname SP@affil@\theSP@author\endcsname{}}
\newcommand\affiliation[1]{\expandafter\def\csname SP@affil@\theSP@author\endcsname{#1}}
\newcommand\SP@date{\today}
\newcommand\preprintdate[1]{\renewcommand\SP@date{#1}}
\renewenvironment{abstract}{\begin{center}\begin{minipage}{0.86\textwidth}\small
  \noindent{\bfseries\color{spaccent}Abstract.}\ \ignorespaces}{\end{minipage}\end{center}\vskip 12pt}
\newcounter{SP@i}

\renewcommand\maketitle{%
  \thispagestyle{SPfirst}%
  \begingroup\centering
  {\fontsize{19}{23}\selectfont\bfseries\@title\par}\vskip 14pt
  \setcounter{SP@i}{0}%
  \loop\ifnum\value{SP@i}<\value{SP@author}\stepcounter{SP@i}%
    {\large\csname SP@author@\theSP@i\endcsname\par}%
    \expandafter\ifx\csname SP@affil@\theSP@i\endcsname\empty\else
      {\small\itshape\csname SP@affil@\theSP@i\endcsname\par}\fi
    \vskip 6pt\repeat
  \vskip 4pt{\small\SP@date\par}\par
  \endgroup
  \vskip 14pt
  \hypersetup{pdfauthor={\csname SP@author@1\endcsname}}%
}

% Preprint notice and page style -----------------------------------------------------------
\fancypagestyle{SPfirst}{\fancyhf{}\renewcommand\headrulewidth{0pt}%
  \ifx\SP@notice\empty\else\fancyfoot[L]{\footnotesize\color{black!65}\SP@notice}\fi
  \fancyfoot[R]{\footnotesize\thepage}}
\fancypagestyle{SPrest}{\fancyhf{}\renewcommand\headrulewidth{0pt}%
  \fancyhead[R]{\footnotesize\color{black!65}\nouppercase{\leftmark}}%
  \ifx\SP@notice\empty\else\fancyfoot[L]{\footnotesize\color{black!65}Preprint}\fi
  \fancyfoot[R]{\footnotesize\thepage}}
\pagestyle{SPrest}

% Sections: numbered, sans-serif headings -------------------------------------------------
\renewcommand\section{\@startsection{section}{1}{\z@}{-3ex \@plus -1ex \@minus -.2ex}{1.6ex \@plus .2ex}{\normalfont\large\bfseries\sffamily\color{spaccent}}}
\renewcommand\subsection{\@startsection{subsection}{2}{\z@}{-2.5ex\@plus -1ex \@minus -.2ex}{1ex \@plus .2ex}{\normalfont\normalsize\bfseries\sffamily}}
\setlength{\parskip}{0.35em}
\setlength{\parindent}{1.2em}
\endinput
