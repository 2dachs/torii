const SERVICE_NAME: &str = "jp.pettal.irori";
const ACCOUNT_NAME: &str = "openrouter_api_key";

pub fn read_openrouter_api_key() -> Result<Option<String>, String> {
  let entry = keyring::Entry::new(SERVICE_NAME, ACCOUNT_NAME).map_err(|err| err.to_string())?;
  match entry.get_password() {
    Ok(value) => Ok(Some(value)),
    Err(_) => Ok(None),
  }
}

pub fn write_openrouter_api_key(value: &str) -> Result<(), String> {
  let entry = keyring::Entry::new(SERVICE_NAME, ACCOUNT_NAME).map_err(|err| err.to_string())?;
  entry.set_password(value).map_err(|err| err.to_string())
}

pub fn clear_openrouter_api_key() -> Result<(), String> {
  let entry = keyring::Entry::new(SERVICE_NAME, ACCOUNT_NAME).map_err(|err| err.to_string())?;
  entry.delete_password().map_err(|err| err.to_string())
}
