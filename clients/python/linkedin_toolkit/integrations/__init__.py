"""Framework wrappers.

Each module imports its framework lazily and raises an ``ImportError`` naming
the extra to install, so ``pip install linkedin-toolkit`` stays small and none
of these frameworks becomes a dependency of the others.

    from linkedin_toolkit import LinkedInToolkit
    from linkedin_toolkit.integrations.langchain import get_tools

    tools = get_tools(LinkedInToolkit())

======================  ==================================================
Module                  Extra
======================  ==================================================
``langchain``           ``pip install "linkedin-toolkit[langchain]"``
``llama_index``         ``pip install "linkedin-toolkit[llamaindex]"``
``crewai``              ``pip install "linkedin-toolkit[crewai]"``
``autogen``             ``pip install "linkedin-toolkit[autogen]"``
``google_adk``          ``pip install "linkedin-toolkit[google-adk]"``
``pydantic_ai``         ``pip install "linkedin-toolkit[pydantic-ai]"``
``smolagents``          ``pip install "linkedin-toolkit[smolagents]"``
======================  ==================================================

Every ``get_tools`` takes the same filter: ``read_only=True`` drops every tool
that writes to LinkedIn, which is the cheapest way to build a sourcing agent
that structurally cannot send anything.
"""

from __future__ import annotations

__all__ = [
    "langchain",
    "llama_index",
    "crewai",
    "autogen",
    "google_adk",
    "pydantic_ai",
    "smolagents",
]
