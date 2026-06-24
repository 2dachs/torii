use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct SearchResult {
  pub title: String,
  pub url: String,
  pub snippet: String,
}

#[derive(Debug, Clone)]
pub struct SearchOptions {
  pub tavily_api_key: String,
  pub tavily_search_depth: String,
  pub max_results: usize,
}

#[derive(Debug, Clone)]
pub struct SearchOutcome {
  pub provider: String,
  pub usage_credits: Option<i64>,
  pub results: Vec<SearchResult>,
}

#[derive(Debug, Serialize)]
struct TavilySearchRequest {
  query: String,
  search_depth: String,
  max_results: usize,
  topic: String,
  include_answer: bool,
  include_raw_content: bool,
  include_images: bool,
  include_usage: bool,
}

#[derive(Debug, Deserialize)]
struct TavilySearchResponse {
  results: Vec<TavilyResult>,
  usage: Option<TavilyUsage>,
}

#[derive(Debug, Deserialize)]
struct TavilyResult {
  title: String,
  url: String,
  content: String,
}

#[derive(Debug, Deserialize)]
struct TavilyUsage {
  credits: i64,
}

#[derive(Debug, Deserialize)]
struct DuckDuckGoResponse {
  #[serde(rename = "Heading")]
  heading: Option<String>,
  #[serde(rename = "AbstractText")]
  abstract_text: Option<String>,
  #[serde(rename = "AbstractURL")]
  abstract_url: Option<String>,
  #[serde(rename = "Results")]
  results: Option<Vec<DuckDuckGoTopic>>,
  #[serde(rename = "RelatedTopics")]
  related_topics: Option<Vec<DuckDuckGoTopic>>,
}

#[derive(Debug, Deserialize)]
struct DuckDuckGoTopic {
  #[serde(rename = "Text")]
  text: Option<String>,
  #[serde(rename = "FirstURL")]
  first_url: Option<String>,
  #[serde(rename = "Topics")]
  topics: Option<Vec<DuckDuckGoTopic>>,
}

pub fn should_search(text: &str) -> bool {
  let lowered = text.to_lowercase();
  [
    "検索",
    "調べて",
    "調べてください",
    "最新",
    "ニュース",
    "web",
    "ウェブ",
    "ネット",
    "現在",
    "今日",
    "直近",
  ]
  .iter()
  .any(|keyword| lowered.contains(keyword))
}

pub fn search_query_from_message(text: &str) -> String {
  let mut query = text.trim().to_string();
  for phrase in [
    "検索してみてください",
    "検索してみて",
    "検索してください",
    "検索して",
    "再検索してください",
    "再検索して",
    "再検索",
    "調べてください",
    "調べて",
    "最新情報",
    "最新の情報",
    "Webで",
    "webで",
    "ウェブで",
    "ネットで",
    "について",
    "もう一度",
    "してみて",
    "みて",
    "を",
    "ください",
    "お願いします",
  ] {
    query = query.replace(phrase, " ");
  }
  query
    .split_whitespace()
    .collect::<Vec<_>>()
    .join(" ")
    .trim_matches(|ch: char| {
      matches!(ch, '。' | '、' | '.' | ',' | '!' | '?' | '！' | '？' | '「' | '」' | '"' | '\'')
    })
    .trim()
    .to_string()
}

pub async fn search_web(query: &str, options: SearchOptions) -> Result<SearchOutcome, String> {
  let tavily_key = options.tavily_api_key.trim();
  let limit = options.max_results.clamp(1, 10);
  if !tavily_key.is_empty() {
    return search_tavily(query, &options, limit).await;
  }

  let encoded = url_encode(query);
  let url = format!(
    "https://api.duckduckgo.com/?q={}&format=json&no_html=1&skip_disambig=1&no_redirect=1",
    encoded
  );
  let client = reqwest::Client::new();
  let mut errors = Vec::new();
  let mut results = Vec::new();

  match client
    .get(url)
    .header("User-Agent", "Irori/0.1")
    .send()
    .await
  {
    Ok(response) => {
      let status = response.status();
      match response.text().await {
        Ok(body) if status.is_success() => {
          results.extend(parse_duckduckgo_json(&body, limit).map_err(|err| {
            errors.push(format!("DuckDuckGo JSON parse failed: {}", err));
            err
          }).unwrap_or_default());
        }
        Ok(body) => errors.push(format!("DuckDuckGo JSON error ({}): {}", status, body.trim())),
        Err(err) => errors.push(format!("DuckDuckGo JSON body failed: {}", err)),
      }
    }
    Err(err) => errors.push(format!("DuckDuckGo JSON request failed: {}", err)),
  }

  results.truncate(limit);
  if results.is_empty() {
    match search_duckduckgo_html(&client, &encoded, limit).await {
      Ok(next_results) => results = next_results,
      Err(err) => errors.push(err),
    }
  }
  if results.is_empty() {
    match search_brave_html(&client, &encoded, limit).await {
      Ok(next_results) => results = next_results,
      Err(err) => errors.push(err),
    }
  }
  if results.is_empty() && errors.len() >= 3 {
    return Err(errors.join(" / "));
  }
  Ok(SearchOutcome {
    provider: "DuckDuckGo/Brave fallback".into(),
    usage_credits: None,
    results,
  })
}

async fn search_tavily(query: &str, options: &SearchOptions, limit: usize) -> Result<SearchOutcome, String> {
  let depth = match options.tavily_search_depth.as_str() {
    "advanced" | "fast" | "ultra-fast" => options.tavily_search_depth.as_str(),
    _ => "basic",
  };
  let request = TavilySearchRequest {
    query: query.to_string(),
    search_depth: depth.to_string(),
    max_results: limit,
    topic: "general".into(),
    include_answer: false,
    include_raw_content: false,
    include_images: false,
    include_usage: true,
  };
  let client = reqwest::Client::new();
  let response = client
    .post("https://api.tavily.com/search")
    .header("Authorization", format!("Bearer {}", options.tavily_api_key.trim()))
    .json(&request)
    .send()
    .await
    .map_err(|err| format!("Tavily search request failed: {}", err))?;

  let status = response.status();
  let body = response.text().await.map_err(|err| err.to_string())?;
  if !status.is_success() {
    return Err(format!("Tavily search error ({}): {}", status, body.trim()));
  }

  let payload: TavilySearchResponse = serde_json::from_str(&body)
    .map_err(|err| format!("Tavily response parse error: {}", err))?;
  let results = payload
    .results
    .into_iter()
    .filter(|result| !result.title.trim().is_empty() && !result.url.trim().is_empty())
    .take(limit)
    .map(|result| SearchResult {
      title: result.title,
      url: result.url,
      snippet: result.content,
    })
    .collect::<Vec<_>>();

  Ok(SearchOutcome {
    provider: format!("Tavily ({})", depth),
    usage_credits: payload.usage.map(|usage| usage.credits),
    results,
  })
}

fn parse_duckduckgo_json(body: &str, limit: usize) -> Result<Vec<SearchResult>, serde_json::Error> {
  let payload: DuckDuckGoResponse = serde_json::from_str(body)?;
  let mut results = Vec::new();

  if let (Some(title), Some(snippet), Some(url)) = (
    payload.heading.filter(|value| !value.trim().is_empty()),
    payload.abstract_text.filter(|value| !value.trim().is_empty()),
    payload.abstract_url.filter(|value| !value.trim().is_empty()),
  ) {
    results.push(SearchResult { title, url, snippet });
  }

  collect_topics(payload.results.unwrap_or_default(), &mut results, limit);
  collect_topics(payload.related_topics.unwrap_or_default(), &mut results, limit);
  results.truncate(limit);
  Ok(results)
}

pub fn format_search_context(query: &str, outcome: &SearchOutcome) -> String {
  if outcome.results.is_empty() {
    return format!(
      "Irori search attempted for query: \"{}\" using {}, but no useful results were returned. Tell the user that the search returned no clear result and answer only if you can do so safely from general knowledge.",
      query,
      outcome.provider
    );
  }

  let usage = outcome
    .usage_credits
    .map(|credits| format!("\nSearch credits used: {}", credits))
    .unwrap_or_default();
  let mut context = format!(
    "Irori has already searched the web for: \"{}\".\nSearch provider: {}{}\nYou DO have web search results below. Do not say you cannot access the internet. Use these results as current external context, cite source URLs when using them, and say clearly if the results are insufficient.\n",
    query,
    outcome.provider,
    usage
  );
  for (index, result) in outcome.results.iter().enumerate() {
    context.push_str(&format!(
      "\n[{}] {}\nURL: {}\nSnippet: {}\n",
      index + 1,
      result.title,
      result.url,
      result.snippet
    ));
  }
  context
}

async fn search_duckduckgo_html(
  client: &reqwest::Client,
  encoded_query: &str,
  limit: usize,
) -> Result<Vec<SearchResult>, String> {
  let url = format!("https://html.duckduckgo.com/html/?q={}", encoded_query);
  let response = client
    .get(url)
    .header("User-Agent", "Mozilla/5.0 Irori/0.1")
    .send()
    .await
    .map_err(|err| format!("Search HTML request failed: {}", err))?;

  let status = response.status();
  let body = response.text().await.map_err(|err| err.to_string())?;
  if !status.is_success() {
    return Err(format!("Search HTML error ({}): {}", status, body.trim()));
  }

  let mut results = Vec::new();
  let mut cursor = body.as_str();
  while results.len() < limit {
    let Some(link_start) = cursor.find("class=\"result__a\"") else { break };
    cursor = &cursor[link_start..];
    let Some(href_start) = cursor.find("href=\"") else { break };
    let after_href = &cursor[href_start + 6..];
    let Some(href_end) = after_href.find('"') else { break };
    let raw_url = decode_html_entities(&strip_duckduckgo_redirect(&after_href[..href_end]));

    let Some(text_start) = after_href[href_end..].find('>') else { break };
    let after_text_start = &after_href[href_end + text_start + 1..];
    let Some(text_end) = after_text_start.find("</a>") else { break };
    let title = clean_html_text(&after_text_start[..text_end]);

    let snippet = if let Some(snippet_start) = after_text_start[text_end..].find("class=\"result__snippet\"") {
      let snippet_cursor = &after_text_start[text_end + snippet_start..];
      if let Some(snippet_text_start) = snippet_cursor.find('>') {
        let snippet_after = &snippet_cursor[snippet_text_start + 1..];
        if let Some(snippet_end) = snippet_after.find("</a>").or_else(|| snippet_after.find("</div>")) {
          clean_html_text(&snippet_after[..snippet_end])
        } else {
          String::new()
        }
      } else {
        String::new()
      }
    } else {
      String::new()
    };

    if !title.is_empty() && !raw_url.is_empty() {
      results.push(SearchResult {
        title,
        url: raw_url,
        snippet,
      });
    }
    cursor = after_text_start;
  }

  Ok(results)
}

async fn search_brave_html(
  client: &reqwest::Client,
  encoded_query: &str,
  limit: usize,
) -> Result<Vec<SearchResult>, String> {
  let url = format!("https://search.brave.com/search?q={}&source=web", encoded_query);
  let response = client
    .get(url)
    .header("User-Agent", "Mozilla/5.0 Irori/0.1")
    .send()
    .await
    .map_err(|err| format!("Brave search request failed: {}", err))?;

  let status = response.status();
  let body = response.text().await.map_err(|err| err.to_string())?;
  if !status.is_success() {
    return Err(format!("Brave search error ({}): {}", status, body.trim()));
  }

  let mut results = Vec::new();
  let mut cursor = body.as_str();
  while results.len() < limit {
    let Some((title, title_end)) = extract_search_string(cursor, &["\"title\":\"", "title:\""]) else { break };
    cursor = &cursor[title_end..];
    let Some((url, url_end)) = extract_search_string(cursor, &["\"url\":\"", "url:\""]) else { break };
    cursor = &cursor[url_end..];
    let Some((snippet, snippet_end)) = extract_search_string(cursor, &["\"description\":\"", "description:\""]) else { break };
    cursor = &cursor[snippet_end..];

    if title_is_noise(&title) || url_is_noise(&url) {
      continue;
    }

    results.push(SearchResult {
      title: clean_json_text(&title),
      url,
      snippet: clean_json_text(&snippet),
    });
  }

  Ok(results)
}

fn extract_search_string(input: &str, markers: &[&str]) -> Option<(String, usize)> {
  markers
    .iter()
    .filter_map(|marker| extract_json_string(input, marker))
    .min_by_key(|(_, index)| *index)
}

fn extract_json_string(input: &str, marker: &str) -> Option<(String, usize)> {
  let marker_start = input.find(marker)?;
  let value_start = marker_start + marker.len();
  let mut escaped = false;
  let mut value = String::new();

  for (offset, ch) in input[value_start..].char_indices() {
    if escaped {
      value.push('\\');
      value.push(ch);
      escaped = false;
      continue;
    }
    match ch {
      '\\' => escaped = true,
      '"' => return Some((decode_json_escapes(&value), value_start + offset + 1)),
      _ => value.push(ch),
    }
  }

  None
}

fn decode_json_escapes(value: &str) -> String {
  value
    .replace("\\u003C", "<")
    .replace("\\u003E", ">")
    .replace("\\u002F", "/")
    .replace("\\u0026", "&")
    .replace("\\\"", "\"")
    .replace("\\n", " ")
    .replace("\\/", "/")
    .replace("\\\\", "\\")
}

fn clean_json_text(value: &str) -> String {
  clean_html_text(value)
}

fn title_is_noise(value: &str) -> bool {
  let lowered = value.to_lowercase();
  lowered.contains("brave search")
    || lowered.contains("google search")
    || lowered.trim().is_empty()
}

fn url_is_noise(value: &str) -> bool {
  value.trim().is_empty()
    || value.starts_with("blob:")
    || value.contains("search.brave.com")
    || value.contains("cdn.search.brave.com")
    || value.contains("imgs.search.brave.com")
    || value.contains("google.com/search")
}

fn collect_topics(topics: Vec<DuckDuckGoTopic>, results: &mut Vec<SearchResult>, limit: usize) {
  for topic in topics {
    if results.len() >= limit {
      return;
    }
    if let Some(nested) = topic.topics {
      collect_topics(nested, results, limit);
      continue;
    }
    let Some(text) = topic.text else { continue };
    let Some(url) = topic.first_url else { continue };
    if text.trim().is_empty() || url.trim().is_empty() {
      continue;
    }
    let title = text
      .split(" - ")
      .next()
      .unwrap_or(&text)
      .chars()
      .take(80)
      .collect::<String>();
    results.push(SearchResult { title, url, snippet: text });
  }
}

fn url_encode(value: &str) -> String {
  let mut encoded = String::new();
  for &byte in value.as_bytes() {
    match byte {
      b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => encoded.push(byte as char),
      b' ' => encoded.push('+'),
      _ => encoded.push_str(&format!("%{:02X}", byte)),
    }
  }
  encoded
}

fn clean_html_text(value: &str) -> String {
  let mut output = String::new();
  let mut in_tag = false;
  for ch in value.chars() {
    match ch {
      '<' => in_tag = true,
      '>' => in_tag = false,
      _ if !in_tag => output.push(ch),
      _ => {}
    }
  }
  decode_html_entities(&output)
    .split_whitespace()
    .collect::<Vec<_>>()
    .join(" ")
}

fn decode_html_entities(value: &str) -> String {
  value
    .replace("&amp;", "&")
    .replace("&quot;", "\"")
    .replace("&#x27;", "'")
    .replace("&#39;", "'")
    .replace("&lt;", "<")
    .replace("&gt;", ">")
}

fn strip_duckduckgo_redirect(value: &str) -> String {
  if let Some(index) = value.find("uddg=") {
    let encoded = value[index + 5..]
      .split('&')
      .next()
      .unwrap_or("");
    percent_decode(encoded)
  } else {
    value.to_string()
  }
}

fn percent_decode(value: &str) -> String {
  let bytes = value.as_bytes();
  let mut output = Vec::new();
  let mut index = 0;
  while index < bytes.len() {
    if bytes[index] == b'%' && index + 2 < bytes.len() {
      if let Ok(hex) = std::str::from_utf8(&bytes[index + 1..index + 3]) {
        if let Ok(byte) = u8::from_str_radix(hex, 16) {
          output.push(byte);
          index += 3;
          continue;
        }
      }
    }
    if bytes[index] == b'+' {
      output.push(b' ');
    } else {
      output.push(bytes[index]);
    }
    index += 1;
  }
  String::from_utf8_lossy(&output).into_owned()
}

#[cfg(test)]
mod tests {
  use super::{extract_json_string, extract_search_string, parse_duckduckgo_json, search_query_from_message};

  #[test]
  fn extracts_core_search_query() {
    assert_eq!(
      search_query_from_message("Sakana AI Fuguについて検索してください"),
      "Sakana AI Fugu"
    );
  }

  #[test]
  fn removes_retry_words_from_search_query() {
    assert_eq!(search_query_from_message("もう一度検索してみてください。"), "");
  }

  #[test]
  fn extracts_escaped_json_string() {
    let input = r#"{"title":"Sakana \"Fugu\"","url":"https:\/\/sakana.ai\/fugu\/"}"#;
    assert_eq!(
      extract_json_string(input, "\"title\":\"").map(|value| value.0),
      Some("Sakana \"Fugu\"".to_string())
    );
    assert_eq!(
      extract_json_string(input, "\"url\":\"").map(|value| value.0),
      Some("https://sakana.ai/fugu/".to_string())
    );
  }

  #[test]
  fn extracts_unquoted_brave_search_fields() {
    let input = r#"{title:"Sakana Fugu",url:"https://sakana.ai/fugu/",description:"A model interface for coordinating agents."}"#;
    assert_eq!(
      extract_search_string(input, &["\"title\":\"", "title:\""]).map(|value| value.0),
      Some("Sakana Fugu".to_string())
    );
    assert_eq!(
      extract_search_string(input, &["\"url\":\"", "url:\""]).map(|value| value.0),
      Some("https://sakana.ai/fugu/".to_string())
    );
  }

  #[test]
  fn duckduckgo_non_json_returns_parse_error_for_fallback() {
    assert!(parse_duckduckgo_json("<html>not json</html>", 5).is_err());
  }
}
