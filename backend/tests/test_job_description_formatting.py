from crawler.parsers.description import html_to_structured_text


def test_html_description_preserves_sections_and_lists():
    result = html_to_structured_text(
        "<h2>Responsibilities</h2><p>Build reliable services.</p>"
        "<ul><li>Review code</li><li>Support teammates</li></ul>"
        "<h2>Qualifications</h2><ol><li>Python</li><li>SQL</li></ol>"
    )

    assert "Responsibilities\n\nBuild reliable services." in result
    assert "- Review code\n- Support teammates" in result
    assert "Qualifications" in result
    assert "1. Python\n2. SQL" in result


def test_plain_text_wording_is_preserved():
    source = "About the Role\nBuild software for customers.\n\nBenefits\nHealth coverage."
    assert html_to_structured_text(source) == source


def test_bullet_heavy_description_stays_a_list():
    result = html_to_structured_text("<ul><li>Build APIs</li><li>Write tests</li><li>Review code</li></ul>")
    assert result.splitlines() == ["- Build APIs", "- Write tests", "- Review code"]


def test_malformed_provider_html_is_readable():
    result = html_to_structured_text("<h3>Requirements<p>Python<li>Clear communication<li>Curiosity")
    assert "Requirements" in result
    assert "Python" in result
    assert "- Clear communication" in result
    assert "- Curiosity" in result


def test_empty_description_is_empty():
    assert html_to_structured_text("") == ""
    assert html_to_structured_text(None) == ""


def test_active_and_embedded_content_is_removed():
    result = html_to_structured_text(
        '<p>Safe wording.</p><script>alert("x")</script>'
        '<style>.hidden{display:none}</style><iframe>unsafe</iframe>'
        '<img src=x onerror="alert(1)">'
    )
    assert result == "Safe wording."
    assert "alert" not in result
    assert "unsafe" not in result
